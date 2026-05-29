// 코스피/코스닥 종목명→코드 마스터 파일을 다운로드·파싱·캐시하는 모듈

import https from 'https';
import zlib from 'zlib';
import iconv from 'iconv-lite';
import { Redis } from '@upstash/redis';

const KOSPI_ZIP_URL  = 'https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip';
const KOSDAQ_ZIP_URL = 'https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip';
const REDIS_KEY = 'kis:stock_master_v1';
const REDIS_TTL = 24 * 60 * 60; // 24시간

export type StockCandidate = { name: string; code: string };

// 프로세스 내 메모리 캐시 (Redis 호출 최소화)
let memCache: { map: Map<string, string>; at: number } | null = null;
const MEM_TTL_MS = 6 * 60 * 60 * 1000; // 6시간

let redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  redis = (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
    ? new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
    : null;
  return redis;
}

function download(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ZIP 버퍼에서 첫 번째 파일 항목을 추출 (adm-zip 없이 직접 파싱)
function extractZip(buf: Buffer): Buffer {
  const SIG = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
  const idx = buf.indexOf(SIG);
  if (idx === -1) throw new Error('ZIP 시그니처를 찾을 수 없습니다.');

  const compression  = buf.readUInt16LE(idx + 8);
  const compSize     = buf.readUInt32LE(idx + 18);
  const fnLen        = buf.readUInt16LE(idx + 26);
  const extraLen     = buf.readUInt16LE(idx + 28);
  const dataStart    = idx + 30 + fnLen + extraLen;
  const data         = buf.slice(dataStart, dataStart + compSize);

  if (compression === 0) return data;                    // stored
  if (compression === 8) return zlib.inflateRawSync(data); // deflate
  throw new Error(`지원하지 않는 압축 방식: ${compression}`);
}

// MST 고정폭 CP949 파일 파싱 → [종목명, 단축코드] 배열 반환
// trailBytes: 각 행 끝의 바이너리 필드 바이트 수 (KOSPI=228, KOSDAQ=222)
function parseMst(buf: Buffer, trailBytes: number): [string, string][] {
  const entries: [string, string][] = [];
  let pos = 0;

  while (pos < buf.length) {
    let end = pos;
    while (end < buf.length && buf[end] !== 0x0A) end++;

    const line    = buf.slice(pos, end);
    const lineLen = line.length > 0 && line[line.length - 1] === 0x0D
      ? line.length - 1
      : line.length;

    if (lineLen > trailBytes + 21) {
      const code = line.slice(0, 9).toString('ascii').trim();
      const name = iconv.decode(line.slice(21, lineLen - trailBytes), 'cp949').trim();
      if (/^\d{6}$/.test(code) && name) entries.push([name, code]);
    }

    pos = end + 1;
  }

  return entries;
}

async function buildMap(): Promise<Map<string, string>> {
  const [kospiZip, kosdaqZip] = await Promise.all([
    download(KOSPI_ZIP_URL),
    download(KOSDAQ_ZIP_URL),
  ]);

  const entries = [
    ...parseMst(extractZip(kospiZip),  228),
    ...parseMst(extractZip(kosdaqZip), 222),
  ];

  return new Map(entries);
}

async function getMasterMap(): Promise<Map<string, string>> {
  // 1단계: 메모리 캐시
  if (memCache && Date.now() - memCache.at < MEM_TTL_MS) return memCache.map;

  // 2단계: Redis 캐시
  const redis = getRedis();
  if (redis) {
    try {
      const stored = await redis.get<Record<string, string>>(REDIS_KEY);
      if (stored) {
        const map = new Map(Object.entries(stored));
        memCache = { map, at: Date.now() };
        return map;
      }
    } catch { /* Redis 실패 시 마스터 파일로 폴백 */ }
  }

  // 3단계: 마스터 파일 다운로드 + 파싱
  const map = await buildMap();
  memCache = { map, at: Date.now() };

  if (redis) {
    try {
      await redis.set(REDIS_KEY, Object.fromEntries(map), { ex: REDIS_TTL });
    } catch { /* 저장 실패 무시 */ }
  }

  return map;
}

// 종목명으로 후보 검색 (정확 일치 우선, 이후 부분 일치 최대 10건)
export async function searchByName(query: string): Promise<StockCandidate[]> {
  const map = await getMasterMap();
  const q = query.trim();
  const qUpper = q.toUpperCase();

  const exactCode = map.get(q) ?? map.get(qUpper);
  if (exactCode) return [{ name: q, code: exactCode }];

  const matches: StockCandidate[] = [];
  for (const [name, code] of map.entries()) {
    if (name.toUpperCase().includes(qUpper)) matches.push({ name, code });
    if (matches.length >= 10) break;
  }

  return matches;
}

// 자동완성용 검색 — 앞글자 일치 우선, 최대 10건
export async function suggestByName(query: string): Promise<StockCandidate[]> {
  const map = await getMasterMap();
  const q = query.trim();
  if (!q) return [];

  const qUpper = q.toUpperCase();
  const starts: StockCandidate[] = [];
  const contains: StockCandidate[] = [];

  for (const [name, code] of map.entries()) {
    const nameUpper = name.toUpperCase();
    if (nameUpper.startsWith(qUpper)) starts.push({ name, code });
    else if (nameUpper.includes(qUpper)) contains.push({ name, code });
    if (starts.length >= 10) break;
  }

  return [...starts, ...contains].slice(0, 10);
}
