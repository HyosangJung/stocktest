// KIS Open API 접근 토큰 상태를 확인하는 API Route (토큰 발급은 kisToken.ts에서 통합 관리)

import { NextResponse } from 'next/server';
import { getKisToken } from '@/lib/kisToken';

export async function GET() {
  try {
    const access_token = await getKisToken();
    return NextResponse.json({ access_token });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '토큰 발급 실패';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
