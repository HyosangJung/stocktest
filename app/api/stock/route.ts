// 종목코드 또는 종목명으로 KIS Open API 실투자 서버에서 현재가를 조회하는 API Route

import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

// 토큰 발급 내부 호출 (같은 서버이므로 fetch 사용)
async function getAccessToken(): Promise<string> {
  const baseUrl = process.env.KIS_BASE_URL!;
  const appKey = process.env.KIS_APP_KEY!;
  const appSecret = process.env.KIS_APP_SECRET!;

  const res = await axios.post(
    `${baseUrl}/oauth2/tokenP`,
    { grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret },
    { headers: { 'Content-Type': 'application/json' } }
  );
  return res.data.access_token;
}

// 종목명으로 종목코드 검색
async function searchTicker(token: string, query: string): Promise<{ ticker: string; name: string } | null> {
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
      PDNO: query,
    },
  });

  const output = res.data?.output;
  if (!output || !output.pdno) return null;
  return { ticker: output.pdno, name: output.prdt_abrv_name };
}

// 종목코드로 현재가 조회 (실투자 tr_id: FHKST01010100)
async function inquirePrice(token: string, ticker: string): Promise<{ name: string; price: string }> {
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
  if (!output) throw new Error('현재가 조회 실패: 응답 데이터 없음');

  return {
    name: output.hts_kor_isnm,   // 종목명
    price: output.stck_prpr,      // 주식 현재가
  };
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('query')?.trim();
  if (!query) {
    return NextResponse.json({ error: '종목명 또는 종목코드를 입력하세요.' }, { status: 400 });
  }

  try {
    const token = await getAccessToken();

    // 6자리 숫자이면 종목코드로 바로 조회, 아니면 종목명 검색 후 조회
    const isTickerCode = /^\d{6}$/.test(query);
    let ticker = query;
    let nameFromSearch: string | undefined;

    if (!isTickerCode) {
      const found = await searchTicker(token, query);
      if (!found) {
        return NextResponse.json({ error: `"${query}" 에 해당하는 종목을 찾을 수 없습니다.` }, { status: 404 });
      }
      ticker = found.ticker;
      nameFromSearch = found.name;
    }

    const { name, price } = await inquirePrice(token, ticker);

    return NextResponse.json({
      name: name || nameFromSearch || ticker,
      price,
      ticker,
    });
  } catch (err: unknown) {
    const message = axios.isAxiosError(err)
      ? JSON.stringify(err.response?.data ?? err.message)
      : '서버 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
