// 종목코드 또는 종목명으로 KIS Open API 실투자 서버에서 현재가를 조회하는 API Route

import { NextRequest, NextResponse } from 'next/server';
import { getKisToken } from '@/lib/kisToken';
import { searchByName, getNameByCode } from '@/lib/stockMaster';
import { BASE_URL, kisHeaders, assertOk, CODE_RE } from '@/lib/kisClient';

const PRICE_REVALIDATE = 3 * 60; // 3분 캐시

// 6자리 종목코드 → 종목명 조회 (KIS API) — 종목명은 자주 안 바뀌므로 24시간 캐시
async function fetchStockName(token: string, ticker: string): Promise<string> {
  const params = new URLSearchParams({ PRDT_TYPE_CD: '300', PDNO: ticker });
  const res = await fetch(
    `${BASE_URL}/uapi/domestic-stock/v1/quotations/search-stock-info?${params}`,
    { headers: { ...kisHeaders(token), tr_id: 'CTPF1002R' }, next: { revalidate: 24 * 60 * 60 } },
  );
  const data = await res.json();
  return data?.output?.prdt_abrv_name ?? ticker;
}

// 현재가 조회 — ETN 코드(알파벳 포함)는 KIS 규칙에 따라 'Q' 접두어 필요
// ETF는 전용 엔드포인트(FHPST02400000)를 사용해야 하므로, 주식 API가 0을 반환하면 ETF API로 폴백
async function inquirePrice(token: string, ticker: string): Promise<string> {
  // Q 접두어는 주식 API(FHKST01010100)에서만 필요한 규칙 — ETF/ETN API는 원본 코드 그대로 사용
  const stockCode = /[A-Z]/i.test(ticker) ? `Q${ticker}` : ticker;
  const fetchOpts = (trId: string, revalidate: number) => ({
    headers: { ...kisHeaders(token), tr_id: trId },
    next: { revalidate },
  });

  // 1차: 주식 현재가 API (ETN은 Q 접두어 코드 사용)
  const stockParams = new URLSearchParams({ FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: stockCode });
  const stockRes = await fetch(
    `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price?${stockParams}`,
    fetchOpts('FHKST01010100', PRICE_REVALIDATE),
  );
  const stockData = await stockRes.json();
  const stockPrice = stockData?.output?.stck_prpr;
  if (stockPrice && stockPrice !== '0') return stockPrice;

  // 2차: ETF/ETN 전용 API 폴백 — 원본 코드 그대로 전달 (Q 접두어 없음)
  const etfParams = new URLSearchParams({ FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: ticker });
  const etfRes = await fetch(
    `${BASE_URL}/uapi/etfetn/v1/quotations/inquire-price?${etfParams}`,
    fetchOpts('FHPST02400000', PRICE_REVALIDATE),
  );
  const etfData = await etfRes.json();
  assertOk(etfData, 'ETF현재가');

  const etfPrice = etfData?.output?.stck_prpr;
  if (etfPrice && etfPrice !== '0') return etfPrice;

  // 장 마감 후 ETF/ETN API는 stck_prpr '0' 반환 → 전일 종가로 폴백
  const prevClose = etfData?.output?.stck_prdy_clpr;
  if (prevClose && prevClose !== '0') return prevClose;

  throw new Error('현재가 조회 실패: ETF/ETN 가격 정보 없음');
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('query')?.trim();
  if (!query) {
    return NextResponse.json({ error: '종목코드 또는 종목명을 입력하세요.' }, { status: 400 });
  }
  if (query.length > 50) {
    return NextResponse.json({ error: '검색어가 너무 깁니다.' }, { status: 400 });
  }

  try {
    const token = await getKisToken();

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
    const message = err instanceof Error ? err.message : '서버 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
