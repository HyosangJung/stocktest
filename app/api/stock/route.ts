// 종목코드 또는 종목명으로 KIS Open API 실투자 서버에서 현재가를 조회하는 API Route

import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { getKisToken } from '@/lib/kisToken';
import { searchByName } from '@/lib/stockMaster';

const BASE_URL   = process.env.KIS_BASE_URL!;
const APP_KEY    = process.env.KIS_APP_KEY!;
const APP_SECRET = process.env.KIS_APP_SECRET!;

const KIS_HEADERS = (token: string) => ({
  'content-type': 'application/json',
  authorization: `Bearer ${token}`,
  appkey: APP_KEY,
  appsecret: APP_SECRET,
  custtype: 'P',
});

async function fetchStockName(token: string, ticker: string): Promise<string> {
  const res = await axios.get(`${BASE_URL}/uapi/domestic-stock/v1/quotations/search-stock-info`, {
    headers: { ...KIS_HEADERS(token), tr_id: 'CTPF1002R' },
    params: { PRDT_TYPE_CD: '300', PDNO: ticker },
  });
  return res.data?.output?.prdt_abrv_name ?? ticker;
}

async function inquirePrice(token: string, ticker: string): Promise<string> {
  const res = await axios.get(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price`, {
    headers: { ...KIS_HEADERS(token), tr_id: 'FHKST01010100' },
    params: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: ticker },
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

    if (!/^\d{6}$/.test(query)) {
      const candidates = await searchByName(query);
      if (candidates.length === 0) {
        return NextResponse.json({ error: `'${query}'에 해당하는 종목을 찾을 수 없습니다.` }, { status: 404 });
      }
      if (candidates.length > 1) {
        return NextResponse.json({ candidates });
      }
      const { name, code } = candidates[0];
      const price = await inquirePrice(token, code);
      return NextResponse.json({ name, price, ticker: code });
    }

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
