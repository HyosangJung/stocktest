// ETF 구성종목시세를 KIS API에서 조회하는 API Route (TR ID: FHKST121600C0)
// cache: 'no-store' — Next.js가 빈 응답을 캐시하면 장중 데이터도 3분간 차단되므로 캐싱 비활성화

import { NextRequest, NextResponse } from 'next/server';
import { getKisToken } from '@/lib/kisToken';
import { BASE_URL, kisHeaders, CODE_RE } from '@/lib/kisClient';

export interface EtfComponent {
  code: string;        // 종목코드 (stck_shrn_iscd) — 해외 종목이면 빈 문자열
  name: string;        // 종목명 (hts_kor_isnm)
  price: string;       // 현재가 (stck_prpr)
  changeSign: string;  // 전일 대비 부호: 1상한 2상승 3보합 4하락 5하한
  changeRate: string;  // 전일 대비율 (prdy_ctrt)
  weight: string;      // 구성비중 % (etf_cnfg_issu_rlim)
  isDomestic: boolean; // 국내 종목 여부 (stck_shrn_iscd 유무)
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
        cache: 'no-store', // 빈 응답 캐싱 방지 — 매 요청마다 KIS에서 직접 조회
      },
    );
    const data = await res.json();
    if (data?.rt_cd !== '0') {
      throw new Error((data?.msg1 as string | undefined)?.trim() ?? 'ETF 구성종목 API 오류');
    }

    // output1: ETF 기본 정보 (구성 종목 수 포함)
    const componentCount = parseInt((data?.output1?.etf_cnfg_issu_cnt as string | undefined) ?? '0', 10);

    // output2: 구성종목 목록
    // - stck_shrn_iscd 없는 항목(해외 종목)도 hts_kor_isnm이 있으면 포함
    const components: EtfComponent[] = (data?.output2 ?? [])
      .filter((item: Record<string, string>) => item.hts_kor_isnm?.trim())
      .map((item: Record<string, string>) => ({
        code: item.stck_shrn_iscd?.trim() ?? '',
        name: item.hts_kor_isnm,
        price: item.stck_prpr ?? '0',
        changeSign: item.prdy_vrss_sign ?? '3',
        changeRate: item.prdy_ctrt ?? '0',
        weight: item.etf_cnfg_issu_rlim ?? '0',
        isDomestic: !!(item.stck_shrn_iscd?.trim()),
      }));

    return NextResponse.json({ components, componentCount });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'ETF 구성종목 조회 실패';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
