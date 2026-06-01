// 종목 일봉/주봉 OHLCV 데이터를 KIS API에서 조회하는 API Route

import { NextRequest, NextResponse } from 'next/server';
import { getKisToken } from '@/lib/kisToken';
import { BASE_URL, kisHeaders, CODE_RE } from '@/lib/kisClient';

interface CandleRaw {
  stck_bsop_date: string;
  stck_oprc: string;
  stck_hgpr: string;
  stck_lwpr: string;
  stck_clpr: string;
  acml_vol: string;
}

export interface CandleData {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Period = '3M' | '1Y' | '10Y';

function toDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function dateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function periodConfig(period: Period): { startDate: string; periodCode: string; maxPages: number } {
  const today = new Date();
  const start = new Date(today);
  if (period === '3M') start.setMonth(start.getMonth() - 3);
  else if (period === '1Y') start.setFullYear(start.getFullYear() - 1);
  else start.setFullYear(start.getFullYear() - 10);

  return {
    startDate: dateStr(start),
    periodCode: period === '10Y' ? 'W' : 'D',
    maxPages: period === '3M' ? 1 : period === '1Y' ? 3 : 6,
  };
}

async function fetchBatch(
  token: string,
  ticker: string,
  periodCode: string,
  startDate: string,
  endDate: string,
): Promise<CandleRaw[]> {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: ticker,
    FID_INPUT_DATE_1: startDate,
    FID_INPUT_DATE_2: endDate,
    FID_PERIOD_DIV_CODE: periodCode,
    FID_ORG_ADJ_PRC: '0',
  });

  const res = await fetch(
    `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?${params}`,
    {
      headers: { ...kisHeaders(token), tr_id: 'FHKST03010100' },
      next: { revalidate: 10 * 60 },
    },
  );
  const data = await res.json();
  if (data?.rt_cd !== '0') {
    throw new Error((data?.msg1 as string | undefined)?.trim() ?? 'KIS 차트 API 오류');
  }
  return (data?.output2 ?? []) as CandleRaw[];
}

async function fetchCandles(token: string, ticker: string, period: Period): Promise<CandleData[]> {
  const { startDate, periodCode, maxPages } = periodConfig(period);
  const today = dateStr(new Date());

  const all: CandleRaw[] = [];
  let endDate = today;

  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchBatch(token, ticker, periodCode, startDate, endDate);
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < 100) break;

    // 다음 호출 기준일: 현재 배치의 가장 오래된 날짜 하루 전 (KIS API는 최신순 반환)
    const oldest = batch.reduce(
      (min, c) => (c.stck_bsop_date < min ? c.stck_bsop_date : min),
      batch[0].stck_bsop_date,
    );
    const d = new Date(oldest.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
    d.setDate(d.getDate() - 1);
    endDate = dateStr(d);
    if (endDate < startDate) break;
  }

  return all
    .filter(c => c.stck_bsop_date && c.stck_clpr !== '0')
    .map(c => ({
      time: toDate(c.stck_bsop_date),
      open: Number(c.stck_oprc),
      high: Number(c.stck_hgpr),
      low: Number(c.stck_lwpr),
      close: Number(c.stck_clpr),
      volume: Number(c.acml_vol),
    }))
    .filter((c, i, arr) => i === arr.findIndex(x => x.time === c.time)) // 중복 제거
    .sort((a, b) => a.time.localeCompare(b.time));
}

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get('ticker')?.trim();
  const period = (req.nextUrl.searchParams.get('period') ?? '3M') as Period;

  if (!ticker) {
    return NextResponse.json({ error: '종목코드를 입력하세요.' }, { status: 400 });
  }
  if (!CODE_RE.test(ticker)) {
    return NextResponse.json({ error: '유효하지 않은 종목코드입니다.' }, { status: 400 });
  }
  if (!(['3M', '1Y', '10Y'] as string[]).includes(period)) {
    return NextResponse.json({ error: '유효하지 않은 기간입니다.' }, { status: 400 });
  }

  try {
    const token = await getKisToken();
    const candles = await fetchCandles(token, ticker, period);
    return NextResponse.json({ candles });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '차트 데이터 조회 실패';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
