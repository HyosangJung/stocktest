// KIS Open API 접근 토큰 발급 및 캐시 관리 모듈
// 토큰은 24시간 유효. Upstash Redis에 저장해 Vercel 멀티 인스턴스 간 공유, 만료 시에만 재발급.
// inflight promise로 동시 요청 시 토큰 중복 발급(스탬피드) 방지.

import { getRedis } from '@/lib/redis';

const REDIS_KEY = 'kis:access_token';
const MARGIN_MS = 5 * 60 * 1000; // 만료 5분 전부터 갱신

let memoryCache: { access_token: string; expires_ms: number } | null = null;
let inflight: Promise<string> | null = null;

interface RedisTokenCache {
  access_token: string;
  expires_ms: number;
}

async function readTokenFromRedis(): Promise<string | null> {
  try {
    const kv = getRedis();
    if (!kv) return null;
    const cached = await kv.get<RedisTokenCache>(REDIS_KEY);
    if (!cached) return null;
    if (cached.expires_ms - MARGIN_MS > Date.now()) {
      memoryCache = cached;
      return cached.access_token;
    }
    return null;
  } catch {
    return null;
  }
}

async function saveTokenToRedis(access_token: string, expires_ms: number): Promise<void> {
  try {
    const kv = getRedis();
    if (!kv) return;
    const ttlSeconds = Math.floor((expires_ms - Date.now()) / 1000);
    if (ttlSeconds > 0) {
      await kv.set<RedisTokenCache>(REDIS_KEY, { access_token, expires_ms }, { ex: ttlSeconds });
    }
  } catch {
    // Redis 저장 실패는 무시 — 다음 요청에서 재시도
  }
}

async function issueNewToken(): Promise<string> {
  const baseUrl = process.env.KIS_BASE_URL!;
  const appKey  = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  const res = await fetch(`${baseUrl}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret }),
    cache: 'no-store',
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`KIS 토큰 발급 실패: ${(data.msg1 as string | undefined) ?? JSON.stringify(data)}`);
  }

  const { access_token, access_token_token_expired } = data as {
    access_token: string;
    access_token_token_expired: string;
  };
  const expires_ms = new Date(access_token_token_expired.replace(' ', 'T')).getTime();

  memoryCache = { access_token, expires_ms };
  await saveTokenToRedis(access_token, expires_ms);
  return access_token;
}

// 외부에서 호출하는 단일 진입점
// 1) 메모리 캐시 유효 → 즉시 반환 (Redis 호출 없음)
// 2) Redis 캐시 유효 → Redis에서 로드 (KIS API 호출 없음)
// 3) 모두 만료/없음 → inflight promise 공유 후 KIS API 호출 → Redis + 메모리에 저장
export async function getKisToken(): Promise<string> {
  if (memoryCache && memoryCache.expires_ms - MARGIN_MS > Date.now()) {
    return memoryCache.access_token;
  }

  const redisToken = await readTokenFromRedis();
  if (redisToken) return redisToken;

  if (!inflight) inflight = issueNewToken().finally(() => { inflight = null; });
  return inflight;
}
