// 종목코드 또는 종목코드로 KIS Open API 실투자 서버에서 현재가를 조회하는 API Route

import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

// 서버 메모리에 토큰 캐싱 (만료 1분 전까지 재사용)
let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expires_at - 60_000 > now) {
    return cachedToken.access_token;
  }

  const baseUrl = process.env.KIS_BASE_URL!;
  const appKey = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  const res = await axios.post(
    `${baseUrl}/oauth2/tokenP`,
    { grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret },
    { headers: { 'Content-Type': 'application/json' } }
  );

  const { access_token, expires_in } = res.data;
  cachedToken = { access_token, expires_at: now + expires_in * 1000 };
  return access_token;
}

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
      PRDT_TYPE_CD: '300',  // 주식
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
      FID_COND_MRKT_DIV_CODE: 'J',  // 주식 시장
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
    return NextResponse.json({ error: '종목명 또는 종목코드를 입력하세요.' }, { status: 400 });
  }

  // 6자리 숫자가 아니면 종목명으로 간주하지만, KIS API는 코드 검색만 지원하므로 안내 반환
  if (!/^\d{6}$/.test(query)) {
    return NextResponse.json(
      { error: '종목코드(6자리 숫자)를 입력하세요. 예: 005930 (삼성전자), 000660 (SK하이닉스)' },
      { status: 400 }
    );
  }

  try {
    const token = await getAccessToken();

    // 종목명과 현재가를 병렬로 조회
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
