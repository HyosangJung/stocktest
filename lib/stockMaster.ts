// 코스피/코스닥 종목명→코드 마스터 파일을 다운로드·파싱·캐시하는 모듈

import https from 'https';
import zlib from 'zlib';
import iconv from 'iconv-lite';
import { getRedis } from '@/lib/redis';

const KOSPI_ZIP_URL  = 'https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip';
const KOSDAQ_ZIP_URL = 'https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip';
const REDIS_KEY = 'kis:stock_master_v2'; // v2: ETN 알파벳 코드 포함
const REDIS_TTL = 24 * 60 * 60; // 24시간

export type StockCandidate = { name: string; code: string };

interface MasterCache {
  nameToCode: Map<string, string>;          // name → code (정확 일치 조회)
  codeToName: Map<string, string>;          // code → name (O(1) 역방향 조회)
  upperEntries: [string, string, string][]; // [upperName, name, code] (검색 루프용 사전 변환)
  at: number;
}

let memCache: MasterCache | null = null;
const MEM_TTL_MS = 6 * 60 * 60 * 1000; // 6시간
let masterInflight: Promise<MasterCache> | null = null;

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

  const compression = buf.readUInt16LE(idx + 8);
  const compSize    = buf.readUInt32LE(idx + 18);
  const fnLen       = buf.readUInt16LE(idx + 26);
  const extraLen    = buf.readUInt16LE(idx + 28);
  const dataStart   = idx + 30 + fnLen + extraLen;
  const data        = buf.slice(dataStart, dataStart + compSize);

  if (compression === 0) return data;
  if (compression === 8) return zlib.inflateRawSync(data);
  throw new Error(`지원하지 않는 압축 방식: ${compression}`);
}

// MST 고정폭 CP949 파일 파싱 → [종목명, 단축코드] 배열 반환
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
      if (/^[A-Z0-9]{6}$/i.test(code) && name) entries.push([name, code]);
    }

    pos = end + 1;
  }

  return entries;
}

async function downloadEntries(): Promise<[string, string][]> {
  const [kospiZip, kosdaqZip] = await Promise.all([
    download(KOSPI_ZIP_URL),
    download(KOSDAQ_ZIP_URL),
  ]);
  return [
    ...parseMst(extractZip(kospiZip),  228),
    ...parseMst(extractZip(kosdaqZip), 222),
  ];
}

// entries로부터 세 가지 인덱스를 한 번에 생성
function buildCacheFromEntries(entries: [string, string][]): MasterCache {
  const nameToCode = new Map(entries);
  const codeToName = new Map(entries.map(([name, code]) => [code, name]));
  const upperEntries = entries.map(
    ([name, code]) => [name.toUpperCase(), name, code] as [string, string, string],
  );
  return { nameToCode, codeToName, upperEntries, at: Date.now() };
}

async function loadFromRedisOrDownload(): Promise<MasterCache> {
  const kv = getRedis();
  if (kv) {
    try {
      const stored = await kv.get<Record<string, string>>(REDIS_KEY);
      if (stored) {
        memCache = buildCacheFromEntries(Object.entries(stored) as [string, string][]);
        return memCache;
      }
    } catch { /* Redis 실패 시 마스터 파일로 폴백 */ }
  }

  const entries = await downloadEntries();
  memCache = buildCacheFromEntries(entries);

  if (kv) {
    try {
      await kv.set(REDIS_KEY, Object.fromEntries(entries), { ex: REDIS_TTL });
    } catch { /* 저장 실패 무시 */ }
  }

  return memCache;
}

// inflight promise로 동시 다운로드 중복 실행 방지
async function getMasterCache(): Promise<MasterCache> {
  if (memCache && Date.now() - memCache.at < MEM_TTL_MS) return memCache;

  if (!masterInflight) {
    masterInflight = loadFromRedisOrDownload().finally(() => { masterInflight = null; });
  }
  return masterInflight;
}

// 종목명으로 후보 검색 (정확 일치 우선, 이후 부분 일치 최대 10건)
export async function searchByName(query: string): Promise<StockCandidate[]> {
  const cache = await getMasterCache();
  const q = query.trim();
  const qUpper = q.toUpperCase();

  const exactCode = cache.nameToCode.get(q) ?? cache.nameToCode.get(qUpper);
  if (exactCode) return [{ name: q, code: exactCode }];

  const matches: StockCandidate[] = [];
  for (const [upperName, name, code] of cache.upperEntries) {
    if (upperName.includes(qUpper)) matches.push({ name, code });
    if (matches.length >= 10) break;
  }
  return matches;
}

// 코드로 종목명 조회 — O(1) 역방향 Map 사용
export async function getNameByCode(code: string): Promise<string | null> {
  const cache = await getMasterCache();
  return cache.codeToName.get(code) ?? null;
}

// 자동완성용 검색 — 앞글자 일치 우선, 포함 일치 후순위, 최대 200건
export async function suggestByName(query: string): Promise<StockCandidate[]> {
  const cache = await getMasterCache();
  const q = query.trim();
  if (!q) return [];

  const qUpper = q.toUpperCase();
  const starts: StockCandidate[] = [];
  const contains: StockCandidate[] = [];

  for (const [upperName, name, code] of cache.upperEntries) {
    if (upperName.startsWith(qUpper)) {
      if (starts.length < 200) starts.push({ name, code });
    } else if (upperName.includes(qUpper)) {
      if (contains.length < 200) contains.push({ name, code });
    }
    if (starts.length >= 200 && contains.length >= 200) break;
  }

  return [...starts, ...contains].slice(0, 200);
}
