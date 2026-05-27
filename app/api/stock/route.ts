// 종목코드로 KIS Open API 실투자 서버에서 현재가를 조회하는 API Route

import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { getKisToken } from '@/lib/kisToken';

// 종목코드로 종목명 조회 (search-stock-info는 PDNO=종목코드만 지원)
async function fetchStockName(token: string, ticker: string): Promise<string> {
  const baseUrl = process.env.KIS_BASE_URL!;
  const appKey = process.env.KIS_APP_KEY!;
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
    params: {
      PRDT_TYPE_CD: '300',
      PDNO: ticker,
    },
  });

  return res.data?.output?.prdt_abrv_name ?? ticker;
}

// 종목코드로 현재가 조회 (실투자 tr_id: FHKST01010100)
async function inquirePrice(token: string, ticker: string): Promise<string> {
  const baseUrl = process.env.KIS_BASE_URL!;
  const appKey = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  const res = await axios.get(`${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-price`, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: 'FHKST01010100',  // 실투자 전용 현재가 조회 코드
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
    return NextResponse.json({ error: '종목코드를 입력하세요.' }, { status: 400 });
  }

  if (!/^\d{6}$/.test(query)) {
    return NextResponse.json(
      { error: '종목코드(6자리 숫자)를 입력하세요. 예: 005930 (삼성전자), 000660 (SK하이닉스)' },
      { status: 400 }
    );
  }

  try {
    const token = await getKisToken();

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
