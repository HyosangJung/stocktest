// KIS Open API 접근 토큰 발급 및 파일 캐시 관리 모듈
// 참고: https://github.com/koreainvestment/open-trading-api/blob/main/examples_user/kis_auth.py
// 토큰은 24시간 유효. 파일에 저장해 서버 재시작/HMR 후에도 재사용하며, 만료 시에만 재발급.

import fs from 'fs';
import path from 'path';
import axios from 'axios';

// 토큰 캐시 파일 경로 (/tmp은 서버 재시작 후에도 짧게 유지됨, 장기 보존 불필요)
const TOKEN_FILE = path.join('/tmp', 'kis_token.json');

interface TokenCache {
  access_token: string;
  expired_at: string; // KIS API가 반환하는 만료 일시 문자열 "YYYY-MM-DD HH:MM:SS"
}

// 프로세스 메모리 캐시 (파일 읽기를 매 요청마다 하지 않기 위한 1차 캐시)
let memoryCache: { access_token: string; expires_ms: number } | null = null;

// 파일에서 토큰 읽기 — 만료되지 않은 경우에만 반환
function readTokenFromFile(): string | null {
  try {
    const raw = fs.readFileSync(TOKEN_FILE, 'utf-8');
    const cache: TokenCache = JSON.parse(raw);

    const expiredAt = new Date(cache.expired_at.replace(' ', 'T')); // ISO 형식으로 변환
    if (expiredAt > new Date()) {
      // 메모리 캐시도 함께 채워둠
      memoryCache = { access_token: cache.access_token, expires_ms: expiredAt.getTime() };
      return cache.access_token;
    }
    return null;
  } catch {
    return null;
  }
}

// 토큰을 파일에 저장
function saveTokenToFile(access_token: string, expired_at: string): void {
  const cache: TokenCache = { access_token, expired_at };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(cache), 'utf-8');
}

// KIS API에서 신규 토큰 발급
async function issueNewToken(): Promise<string> {
  const baseUrl = process.env.KIS_BASE_URL!;
  const appKey = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  const res = await axios.post(
    `${baseUrl}/oauth2/tokenP`,
    { grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret },
    { headers: { 'Content-Type': 'application/json' } }
  );

  const { access_token, access_token_token_expired } = res.data;
  // access_token_token_expired 예시: "2024-05-28 09:30:00"

  saveTokenToFile(access_token, access_token_token_expired);

  const expiresMs = new Date(access_token_token_expired.replace(' ', 'T')).getTime();
  memoryCache = { access_token, expires_ms: expiresMs };

  return access_token;
}

// 외부에서 호출하는 단일 진입점
// 1) 메모리 캐시 유효 → 즉시 반환
// 2) 파일 캐시 유효 → 파일에서 로드 후 반환
// 3) 모두 만료/없음 → KIS API 호출 후 저장 및 반환
export async function getKisToken(): Promise<string> {
  const now = Date.now();
  const MARGIN_MS = 5 * 60 * 1000; // 만료 5분 전부터 갱신

  // 1단계: 메모리 캐시
  if (memoryCache && memoryCache.expires_ms - MARGIN_MS > now) {
    return memoryCache.access_token;
  }

  // 2단계: 파일 캐시
  const fileToken = readTokenFromFile();
  if (fileToken) {
    return fileToken;
  }

  // 3단계: 신규 발급
  return issueNewToken();
}
