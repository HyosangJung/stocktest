// 종목코드 또는 종목명으로 KIS Open API 실투자 서버에서 현재가를 조회하는 API Route

import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { getKisToken } from '@/lib/kisToken';
import { searchByName, getNameByCode } from '@/lib/stockMaster';

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

// 6자리 숫자 코드 → 종목명 조회 (KIS API)
async function fetchStockName(token: string, ticker: string): Promise<string> {
  const res = await axios.get(`${BASE_URL}/uapi/domestic-stock/v1/quotations/search-stock-info`, {
    headers: { ...KIS_HEADERS(token), tr_id: 'CTPF1002R' },
    params: { PRDT_TYPE_CD: '300', PDNO: ticker },
  });
  return res.data?.output?.prdt_abrv_name ?? ticker;
}

// 현재가 조회 — ETN 코드(알파벳 포함)는 KIS 규칙에 따라 'Q' 접두어 필요
async function inquirePrice(token: string, ticker: string): Promise<string> {
  const inputCode = /[A-Z]/i.test(ticker) ? `Q${ticker}` : ticker;
  const res = await axios.get(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price`, {
    headers: { ...KIS_HEADERS(token), tr_id: 'FHKST01010100' },
    params: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: inputCode },
  });
  const output = res.data?.output;
  if (!output?.stck_prpr) throw new Error('현재가 조회 실패: 응답 데이터 없음');
  return output.stck_prpr;
}

// 6자리 종목코드 여부 판별 (숫자 전용 + 알파벳 포함 ETN 코드 모두 인식)
const CODE_RE = /^[A-Z0-9]{6}$/i;

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('query')?.trim();
  if (!query) {
    return NextResponse.json({ error: '종목코드 또는 종목명을 입력하세요.' }, { status: 400 });
  }

  try {
    const token = await getKisToken();

    // 종목코드가 아닌 경우 → 종목명으로 검색
    if (!CODE_RE.test(query)) {
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

    // 종목코드 직접 조회
    // ETN(알파벳 포함) 코드는 마스터 캐시에서 이름 조회, 일반 코드는 KIS API 사용
    const isEtn = /[A-Z]/i.test(query);
    const [name, price] = await Promise.all([
      isEtn
        ? getNameByCode(query).then(n => n ?? query)
        : fetchStockName(token, query),
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
