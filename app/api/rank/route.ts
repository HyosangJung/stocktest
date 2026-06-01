// HTS조회상위20종목(국내주식-214)·공매도상위종목(국내주식-133)·시가총액상위(v1_국내주식-091) 조회 API Route

import { NextRequest, NextResponse } from 'next/server';
import { getKisToken } from '@/lib/kisToken';
import { BASE_URL, kisHeaders } from '@/lib/kisClient';
import { getNameByCode } from '@/lib/stockMaster';

export interface HtsItem {
  rank: number;
  code: string;
  name: string;
  market: string; // 코스피 | 코스닥
}

export interface MarketCapItem {
  rank: number;
  code: string;
  name: string;
  price: string;
  prdyVrssSign: string;
  prdyCtrt: string;
  stckAvls: string;       // 시가총액 (억원)
  mrktWholAvlsRlim: string; // 시장 전체 시가총액 비중 %
}

export interface ShortSaleItem {
  rank: number;
  code: string;
  name: string;
  price: string;
  prdyVrss: string;
  prdyVrssSign: string;
  prdyCtrt: string;
  sstsVolRlim: string;
  sstsTrPbmnRlim: string;
}

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type');

  if (type === 'hts') {
    try {
      const token = await getKisToken();
      const res = await fetch(
        `${BASE_URL}/uapi/domestic-stock/v1/ranking/hts-top-view`,
        {
          headers: { ...kisHeaders(token), tr_id: 'HHMCM000100C0' },
          cache: 'no-store',
        },
      );
      const data = await res.json();
      if (data?.rt_cd !== '0') {
        throw new Error((data?.msg1 as string | undefined)?.trim() ?? 'HTS조회 API 오류');
      }

      const raw: Array<{ mrkt_div_cls_code: string; mksc_shrn_iscd: string }> = data?.output1 ?? [];
      const items: HtsItem[] = await Promise.all(
        raw.map(async (item, i) => ({
          rank: i + 1,
          code: item.mksc_shrn_iscd,
          name: (await getNameByCode(item.mksc_shrn_iscd)) ?? item.mksc_shrn_iscd,
          market: item.mrkt_div_cls_code === 'J' ? '코스피' : '코스닥',
        })),
      );

      return NextResponse.json({ items });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'HTS조회 조회 실패';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (type === 'short-sale') {
    try {
      const token = await getKisToken();
      const params = new URLSearchParams({
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_COND_SCR_DIV_CODE: '20482',
        FID_INPUT_ISCD: '0000',
        FID_PERIOD_DIV_CODE: 'D',
        FID_INPUT_CNT_1: '0',
        FID_TRGT_EXLS_CLS_CODE: '0',
        FID_TRGT_CLS_CODE: '0',
        FID_APLY_RANG_PRC_1: '',
        FID_APLY_RANG_PRC_2: '',
        FID_APLY_RANG_VOL: '0',
      });

      const res = await fetch(
        `${BASE_URL}/uapi/domestic-stock/v1/ranking/short-sale?${params}`,
        {
          headers: { ...kisHeaders(token), tr_id: 'FHPST04820000' },
          cache: 'no-store',
        },
      );
      const data = await res.json();
      if (data?.rt_cd !== '0') {
        throw new Error((data?.msg1 as string | undefined)?.trim() ?? '공매도 API 오류');
      }

      const raw: Array<Record<string, string>> = data?.output ?? [];
      const items: ShortSaleItem[] = raw.slice(0, 30).map((item, i) => ({
        rank: i + 1,
        code: item.mksc_shrn_iscd,
        name: item.hts_kor_isnm,
        price: item.stck_prpr,
        prdyVrss: item.prdy_vrss,
        prdyVrssSign: item.prdy_vrss_sign,
        prdyCtrt: item.prdy_ctrt,
        sstsVolRlim: item.ssts_vol_rlim,
        sstsTrPbmnRlim: item.ssts_tr_pbmn_rlim,
      }));

      return NextResponse.json({ items });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '공매도 조회 실패';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (type === 'market-cap') {
    try {
      const token = await getKisToken();
      const params = new URLSearchParams({
        fid_cond_mrkt_div_code: 'J',
        fid_cond_scr_div_code: '20174',
        fid_div_cls_code: '0',
        fid_input_iscd: '0000',
        fid_trgt_cls_code: '0',
        fid_trgt_exls_cls_code: '0',
        fid_input_price_1: '',
        fid_input_price_2: '',
        fid_vol_cnt: '',
      });

      const res = await fetch(
        `${BASE_URL}/uapi/domestic-stock/v1/ranking/market-cap?${params}`,
        {
          headers: { ...kisHeaders(token), tr_id: 'FHPST01740000' },
          cache: 'no-store',
        },
      );
      const data = await res.json();
      if (data?.rt_cd !== '0') {
        throw new Error((data?.msg1 as string | undefined)?.trim() ?? '시가총액 API 오류');
      }

      const raw: Array<Record<string, string>> = data?.output ?? [];
      const items: MarketCapItem[] = raw.slice(0, 30).map((item, i) => ({
        rank: i + 1,
        code: item.mksc_shrn_iscd,
        name: item.hts_kor_isnm,
        price: item.stck_prpr,
        prdyVrssSign: item.prdy_vrss_sign,
        prdyCtrt: item.prdy_ctrt,
        stckAvls: item.stck_avls,
        mrktWholAvlsRlim: item.mrkt_whol_avls_rlim,
      }));

      return NextResponse.json({ items });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '시가총액 조회 실패';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: '유효하지 않은 type 파라미터입니다.' }, { status: 400 });
}
