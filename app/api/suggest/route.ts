// 종목명 자동완성 후보를 반환하는 API Route

import { NextRequest, NextResponse } from 'next/server';
import { suggestByName } from '@/lib/stockMaster';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q || /^\d{6}$/.test(q)) {
    return NextResponse.json({ suggestions: [] });
  }
  const suggestions = await suggestByName(q);
  return NextResponse.json({ suggestions });
}
