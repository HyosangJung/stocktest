// 종목 일봉/주봉 종가 + 거래량 통합 차트 컴포넌트

'use client';

import { useEffect, useRef, useState } from 'react';
import { createChart, LineSeries, isBusinessDay } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import type { CandleData, Period } from '@/app/api/chart/route';

interface Props {
  ticker: string;
  name: string;
}

const PERIODS: { label: string; value: Period }[] = [
  { label: '3M', value: '3M' },
  { label: '1Y', value: '1Y' },
  { label: '10Y', value: '10Y' },
];

const ALL_PERIODS = PERIODS.map(p => p.value);

export default function StockChart({ ticker, name }: Props) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const chartRef       = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volSeriesRef   = useRef<ISeriesApi<'Line'> | null>(null);
  const observerRef    = useRef<ResizeObserver | null>(null);
  const cacheRef       = useRef<Map<string, CandleData[]>>(new Map()); // `${ticker}:${period}`
  const periodRef      = useRef<Period>('3M'); // 항상 최신 period 참조

  const [period, setPeriod]         = useState<Period>('3M');
  const [candles, setCandles]       = useState<CandleData[] | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [prefetched, setPrefetched] = useState<Set<Period>>(new Set());

  // periodRef 동기화
  periodRef.current = period;

  // 종목 변경 시: 세 기간 모두 병렬 prefetch
  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;

    // 새 종목 — 화면 초기화
    setCandles(null);
    setError(null);
    setPrefetched(new Set());

    ALL_PERIODS.forEach(p => {
      const key = `${ticker}:${p}`;

      // 이미 캐시된 경우 재사용
      if (cacheRef.current.has(key)) {
        if (p === periodRef.current) setCandles(cacheRef.current.get(key)!);
        setPrefetched(prev => new Set(prev).add(p));
        return;
      }

      fetch(`/api/chart?ticker=${encodeURIComponent(ticker)}&period=${p}`)
        .then(r => r.json())
        .then((data: { candles?: CandleData[]; error?: string }) => {
          if (cancelled) return;
          if (data.candles?.length) {
            cacheRef.current.set(key, data.candles);
            // 현재 활성 기간이면 화면에 반영
            if (p === periodRef.current) setCandles(data.candles);
          } else if (p === periodRef.current) {
            setError(data.error ?? '차트 데이터가 없습니다.');
          }
          setPrefetched(prev => new Set(prev).add(p));
        })
        .catch(() => {
          if (cancelled || p !== periodRef.current) return;
          setError('차트를 불러오는 중 오류가 발생했습니다.');
        });
    });

    return () => { cancelled = true; };
  }, [ticker]);

  // 기간 변경 시: 캐시 히트면 즉시, 미스면 prefetch 완료 대기
  useEffect(() => {
    if (!ticker) return;
    const key = `${ticker}:${period}`;
    const cached = cacheRef.current.get(key);
    if (cached) {
      setCandles(cached);
      setError(null);
    } else {
      setCandles(null); // 로딩 표시 — prefetch 완료 시 ticker effect 콜백이 반영
    }
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  // 차트 렌더링: 기존 인스턴스 재사용, 없으면 생성
  useEffect(() => {
    if (!candles || !containerRef.current) return;

    const container = containerRef.current;

    if (chartRef.current && priceSeriesRef.current && volSeriesRef.current) {
      // 기존 차트에 데이터만 교체 — 인스턴스 재생성 없이 기간 전환
      priceSeriesRef.current.setData(candles.map(c => ({ time: c.time, value: c.close })));
      volSeriesRef.current.setData(candles.map(c => ({ time: c.time, value: c.volume })));
      chartRef.current.timeScale().setVisibleRange({
        from: candles[0].time as Time,
        to: candles[candles.length - 1].time as Time,
      });
      return;
    }

    // 최초 차트 생성
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 360,
      layout: {
        background: { color: 'transparent' },
        textColor: 'rgba(255,255,255,0.7)',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.06)' },
        horzLines: { color: 'rgba(255,255,255,0.06)' },
      },
      crosshair: { mode: 1 },
      handleScroll: false,
      handleScale: false,
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.15)' },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.15)',
        timeVisible: false,
        rightOffset: 0,
      },
      localization: {
        timeFormatter: (t: Time) => {
          if (isBusinessDay(t)) {
            const yy = String(t.year).slice(2);
            const mm = String(t.month).padStart(2, '0');
            const dd = String(t.day).padStart(2, '0');
            return `${yy}-${mm}-${dd}`;
          }
          return String(t);
        },
      },
    });

    // 패널 0 — 종가 선
    chart.panes()[0].setHeight(270);
    const priceSeries = chart.addSeries(LineSeries, {
      color: '#f97316',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      priceLineVisible: true,
      priceFormat: {
        type: 'custom',
        minMove: 1,
        formatter: (p: number) => Math.round(p).toLocaleString('ko-KR'),
      },
    });
    priceSeries.setData(candles.map(c => ({ time: c.time, value: c.close })));

    // 패널 1 — 거래량 선
    const volPane = chart.addPane();
    volPane.setHeight(80);
    const volSeries = chart.addSeries(
      LineSeries,
      {
        color: 'rgba(255,255,255,0.4)',
        lineWidth: 1,
        crosshairMarkerVisible: true,
        priceLineVisible: false,
        priceFormat: {
          type: 'custom',
          minMove: 1,
          formatter: (v: number) => {
            if (v >= 1_000_000) return `${Math.round(v / 1_000_000)}M`;
            if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
            return String(Math.round(v));
          },
        },
      },
      1,
    );
    volSeries.setData(candles.map(c => ({ time: c.time, value: c.volume })));

    chart.timeScale().setVisibleRange({
      from: candles[0].time as Time,
      to: candles[candles.length - 1].time as Time,
    });

    chartRef.current = chart;
    priceSeriesRef.current = priceSeries;
    volSeriesRef.current = volSeries;

    const resizeObserver = new ResizeObserver(() => {
      chartRef.current?.applyOptions({ width: container.clientWidth });
    });
    resizeObserver.observe(container);
    observerRef.current = resizeObserver;
  }, [candles]);

  // 컴포넌트 언마운트 시 차트 정리
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
      volSeriesRef.current = null;
    };
  }, []);

  const loading = !candles && !error;

  return (
    <div className="mt-3 bg-white/10 border border-white/20 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10">
        <span className="text-white/70 text-sm font-medium">{name}</span>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-28">
          <span className="text-white/40 text-xs">차트 로딩 중...</span>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center h-28">
          <span className="text-white/50 text-xs">{error}</span>
        </div>
      )}

      <div className={`px-2 pt-2 ${!candles ? 'hidden' : ''}`}>
        <div ref={containerRef} className="w-full" />
      </div>

      {/* 기간 선택 버튼 */}
      <div className="flex justify-center gap-2 py-3">
        {PERIODS.map(p => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`px-4 py-1 rounded-full text-xs font-medium transition-colors border ${
              period === p.value
                ? 'bg-white/20 border-white/50 text-white'
                : prefetched.has(p.value)
                  ? 'bg-transparent border-white/20 text-white/40 hover:border-white/35 hover:text-white/60'
                  : 'bg-transparent border-white/10 text-white/20 cursor-wait'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
