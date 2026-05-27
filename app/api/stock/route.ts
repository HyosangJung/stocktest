// 종목코드 또는 종목명으로 KIS Open API 실투자 서버에서 현재가를 조회하는 API Route

import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { getKisToken } from '@/lib/kisToken';
import { searchByName } from '@/lib/stockMaster';

// 종목코드로 종목명 조회 (CTPF1002R)
async function fetchStockName(token: string, ticker: string): Promise<string> {
  const baseUrl   = process.env.KIS_BASE_URL!;
  const appKey    = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  const res = await axios.get(`${baseUrl}/uapi/domestic-stock/v1/quotations/search-stock-info`, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: 'CTPF1002R',
      custtype: 'P',
    },
    params: { PRDT_TYPE_CD: '300', PDNO: ticker },
  });

  return res.data?.output?.prdt_abrv_name ?? ticker;
}

// 종목코드로 현재가 조회 (FHKST01010100)
async function inquirePrice(token: string, ticker: string): Promise<string> {
  const baseUrl   = process.env.KIS_BASE_URL!;
  const appKey    = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  const res = await axios.get(`${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-price`, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: 'FHKST01010100',
      custtype: 'P',
    },
    params: {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: ticker,
    },
  });

  const output = res.data?.output;
  if (!output?.stck_prpr) throw new Error('현재가 조회 실패: 응답 데이터 없음');
  return output.stck_prpr;
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('query')?.trim();
  if (!query) {
    return NextResponse.json({ error: '종목코드 또는 종목명을 입력하세요.' }, { status: 400 });
  }

  try {
    const token = await getKisToken();

    // 종목코드(6자리 숫자)가 아닌 경우 → 종목명으로 검색
    if (!/^\d{6}$/.test(query)) {
      const candidates = await searchByName(query);

      if (candidates.length === 0) {
        return NextResponse.json(
          { error: `'${query}'에 해당하는 종목을 찾을 수 없습니다.` },
          { status: 404 }
        );
      }

      // 후보가 여러 개면 선택 목록 반환
      if (candidates.length > 1) {
        return NextResponse.json({ candidates });
      }

      // 1개 매칭 → 바로 현재가 조회
      const { name, code } = candidates[0];
      const price = await inquirePrice(token, code);
      return NextResponse.json({ name, price, ticker: code });
    }

    // 종목코드로 직접 조회
    const [name, price] = await Promise.all([
      fetchStockName(token, query),
      inquirePrice(token, query),
    ]);

    return NextResponse.json({ name, price, ticker: query });
  } catch (err: unknown) {
    const message = axios.isAxiosError(err)
      ? JSON.stringify(err.response?.data ?? err.message)
      : '서버 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
