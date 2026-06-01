// ETF 구성종목시세를 KIS API에서 조회하는 API Route (TR ID: FHKST121600C0)
// 장중 조회 성공 시 Redis에 캐싱 → 장 마감 후 KIS API가 빈 응답을 반환하면 캐시로 폴백

import { NextRequest, NextResponse } from 'next/server';
import { getKisToken } from '@/lib/kisToken';
import { BASE_URL, kisHeaders, CODE_RE } from '@/lib/kisClient';
import { getRedis } from '@/lib/redis';

export interface EtfComponent {
  code: string;        // 종목코드 (stck_shrn_iscd) — 해외 종목이면 빈 문자열
  name: string;        // 종목명 (hts_kor_isnm)
  weight: string;      // 구성비중 % (etf_cnfg_issu_rlim)
  isDomestic: boolean; // 국내 종목 여부 (stck_shrn_iscd 유무)
}

interface CachedPayload {
  components: EtfComponent[];
  componentCount: number;
  cachedAt: number; // Unix ms
}

const CACHE_TTL = 7 * 24 * 60 * 60; // 7일 — 구성 종목은 분기별로만 바뀜

function redisKey(ticker: string) {
  return `etf:components:v1:${ticker}`;
}

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get('ticker')?.trim();
  if (!ticker) {
    return NextResponse.json({ error: '종목코드를 입력하세요.' }, { status: 400 });
  }
  if (!CODE_RE.test(ticker)) {
    return NextResponse.json({ error: '유효하지 않은 종목코드입니다.' }, { status: 400 });
  }

  try {
    const token = await getKisToken();
    const params = new URLSearchParams({
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: ticker,
      FID_COND_SCR_DIV_CODE: '11216',
    });

    const res = await fetch(
      `${BASE_URL}/uapi/etfetn/v1/quotations/inquire-component-stock-price?${params}`,
      {
        headers: { ...kisHeaders(token), tr_id: 'FHKST121600C0' },
        cache: 'no-store',
      },
    );
    const data = await res.json();
    if (data?.rt_cd !== '0') {
      throw new Error((data?.msg1 as string | undefined)?.trim() ?? 'ETF 구성종목 API 오류');
    }

    // output1: ETF 기본 정보 (구성 종목 수 포함)
    const componentCount = parseInt((data?.output1?.etf_cnfg_issu_cnt as string | undefined) ?? '0', 10);

    // output2: 구성종목 목록 — tr_cont 연속조회 불가 API, 단일 호출로 전체 반환
    // stck_shrn_iscd 없는 항목(해외 종목)도 hts_kor_isnm이 있으면 포함
    const components: EtfComponent[] = (data?.output2 ?? [])
      .filter((item: Record<string, string>) => item.hts_kor_isnm?.trim())
      .map((item: Record<string, string>) => ({
        code: item.stck_shrn_iscd?.trim() ?? '',
        name: item.hts_kor_isnm,
        weight: item.etf_cnfg_issu_rlim ?? '0',
        isDomestic: !!(item.stck_shrn_iscd?.trim()),
      }));

    // 장중 유효 데이터 → Redis 캐시 갱신 (실패해도 무시)
    if (components.length > 0) {
      const kv = getRedis();
      if (kv) {
        const payload: CachedPayload = { components, componentCount, cachedAt: Date.now() };
        kv.set(redisKey(ticker), payload, { ex: CACHE_TTL }).catch(() => {});
      }
      return NextResponse.json({ components, componentCount });
    }

    // 장 마감 등으로 빈 응답 → Redis 캐시 폴백
    const kv = getRedis();
    if (kv) {
      const cached = await kv.get<CachedPayload>(redisKey(ticker));
      if (cached && cached.components.length > 0) {
        return NextResponse.json({
          components: cached.components,
          componentCount: cached.componentCount,
          cachedAt: cached.cachedAt,
        });
      }
    }

    // 캐시도 없으면 기존 빈-응답 에러 처리로 넘김
    return NextResponse.json({ components: [], componentCount });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'ETF 구성종목 조회 실패';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
