// KIS Open API 접근 토큰 발급 및 캐시 관리 모듈
// 참고: https://github.com/koreainvestment/open-trading-api/blob/main/examples_user/kis_auth.py
// 토큰은 24시간 유효. Upstash Redis에 저장해 Vercel 멀티 인스턴스 간 공유, 만료 시에만 재발급.

import { Redis } from '@upstash/redis';
import axios from 'axios';

const REDIS_KEY = 'kis:access_token';
const MARGIN_MS = 5 * 60 * 1000; // 만료 5분 전부터 갱신

// KV_REST_API_URL / KV_REST_API_TOKEN 환경변수를 자동으로 읽음 (Upstash 표준)
let redis: Redis | null = null;
function getRedis(): Redis | null {
  if (redis) return redis;
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return redis;
}

// 프로세스 메모리 캐시 (Redis 호출 횟수 최소화용 1차 캐시)
let memoryCache: { access_token: string; expires_ms: number } | null = null;

interface RedisTokenCache {
  access_token: string;
  expires_ms: number;
}

// Redis에서 토큰 읽기
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

// Redis에 토큰 저장 (TTL = 만료까지 남은 초)
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

// KIS API에서 신규 토큰 발급 후 저장
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
  // access_token_token_expired 예시: "2026-05-28 09:30:00"
  const expires_ms = new Date(access_token_token_expired.replace(' ', 'T')).getTime();

  memoryCache = { access_token, expires_ms };
  await saveTokenToRedis(access_token, expires_ms);

  return access_token;
}

// 외부에서 호출하는 단일 진입점
// 1) 메모리 캐시 유효 → 즉시 반환 (Redis 호출 없음)
// 2) Redis 캐시 유효 → Redis에서 로드 (KIS API 호출 없음)
// 3) 모두 만료/없음 → KIS API 호출 → Redis + 메모리에 저장
export async function getKisToken(): Promise<string> {
  // 1단계: 메모리 캐시
  if (memoryCache && memoryCache.expires_ms - MARGIN_MS > Date.now()) {
    return memoryCache.access_token;
  }

  // 2단계: Redis 캐시
  const redisToken = await readTokenFromRedis();
  if (redisToken) return redisToken;

  // 3단계: 신규 발급
  return issueNewToken();
}
