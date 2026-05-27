// KIS Open API 액세스 토큰을 발급하고 서버 메모리에 캐싱하는 API Route

import { NextResponse } from 'next/server';
import axios from 'axios';

// 서버 메모리에 토큰 캐싱 (만료 시각 포함)
let cachedToken: { access_token: string; expires_at: number } | null = null;

export async function GET() {
  const now = Date.now();

  // 캐시된 토큰이 유효하면 재사용 (만료 1분 전까지 유효로 처리)
  if (cachedToken && cachedToken.expires_at - 60_000 > now) {
    return NextResponse.json({ access_token: cachedToken.access_token });
  }

  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  const baseUrl = process.env.KIS_BASE_URL;

  if (!appKey || !appSecret || !baseUrl) {
    return NextResponse.json({ error: '환경변수 누락' }, { status: 500 });
  }

  try {
    const res = await axios.post(
      `${baseUrl}/oauth2/tokenP`,
      {
        grant_type: 'client_credentials',
        appkey: appKey,
        appsecret: appSecret,
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const { access_token, expires_in } = res.data;
    // expires_in은 초 단위
    cachedToken = { access_token, expires_at: now + expires_in * 1000 };

    return NextResponse.json({ access_token });
  } catch (err: unknown) {
    const message = axios.isAxiosError(err)
      ? err.response?.data ?? err.message
      : '토큰 발급 실패';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
