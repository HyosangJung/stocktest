// 종목 개요 · ETF 종목 분해 탭을 제공하는 메인 페이지

'use client';

import { useState, useEffect, useRef } from 'react';
import StockDetail from '@/app/components/StockDetail';
import type { StockCandidate } from '@/lib/stockMaster';
import type { EtfComponent } from '@/app/api/etf-components/route';
import type { HtsItem, ShortSaleItem, MarketCapItem } from '@/app/api/rank/route';

interface StockResult {
  name: string;
  price: string;
  ticker: string;
}

type TabKey = 'overview' | 'etf' | 'rank';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '종목 개요' },
  { key: 'etf', label: 'ETF 종목 분해' },
  { key: 'rank', label: 'Rank' },
];

// 클라이언트에서 포맷 검증용 (서버 kisClient와 동일 패턴)
const CODE_RE = /^[A-Z0-9]{6}$/i;
const SUGGEST_CACHE_MAX = 100;


export default function Home() {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  // 공유 검색 상태
  const [query, setQuery]             = useState('');
  const [candidates, setCandidates]   = useState<StockCandidate[]>([]);
  const [suggestions, setSuggestions] = useState<StockCandidate[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [loading, setLoading]         = useState(false);

  // 종목 개요 탭 상태
  const [result, setResult]             = useState<StockResult | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Rank 탭 상태
  const [rankSubTab, setRankSubTab]       = useState<'hts' | 'short-sale' | 'market-cap' | null>(null);
  const [htsItems, setHtsItems]           = useState<HtsItem[] | null>(null);
  const [shortSaleItems, setShortSaleItems] = useState<ShortSaleItem[] | null>(null);
  const [marketCapItems, setMarketCapItems] = useState<MarketCapItem[] | null>(null);
  const [rankLoading, setRankLoading]     = useState(false);
  const [rankError, setRankError]         = useState<string | null>(null);

  // ETF 종목 분해 탭 상태
  const [etfComponents, setEtfComponents]         = useState<EtfComponent[] | null>(null);
  const [etfComponentCount, setEtfComponentCount] = useState<number>(0);
  const [etfCachedAt, setEtfCachedAt]             = useState<number | null>(null);
  const [selectedComponent, setSelectedComponent] = useState<EtfComponent | null>(null);
  const [etfError, setEtfError]                   = useState<string | null>(null);

  const debounceRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justSelectedRef = useRef(false);
  const suggestCache    = useRef<Map<string, StockCandidate[]>>(new Map());

  // 키 입력마다 자동완성 후보 조회 (200ms 디바운스)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }

    const q = query.trim();
    if (!q || /^\d{6}$/.test(q)) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const cached = suggestCache.current.get(q);
        if (cached) {
          setSuggestions(cached);
          setShowSuggestions(cached.length > 0);
          setHighlighted(-1);
          return;
        }
        const res  = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        const list: StockCandidate[] = data.suggestions ?? [];

        if (suggestCache.current.size >= SUGGEST_CACHE_MAX) {
          const firstKey = suggestCache.current.keys().next().value!;
          suggestCache.current.delete(firstKey);
        }
        suggestCache.current.set(q, list);

        setSuggestions(list);
        setShowSuggestions(list.length > 0);
        setHighlighted(-1);
      } catch {
        // 자동완성 오류는 무시
      }
    }, 200);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  async function fetchPrice(q: string) {
    setLoading(true);
    setOverviewError(null);
    setResult(null);
    setCandidates([]);
    setSuggestions([]);
    setShowSuggestions(false);

    try {
      const res  = await fetch(`/api/stock?query=${encodeURIComponent(q.trim())}`);
      const data = await res.json();

      if (!res.ok) {
        setOverviewError(data.error ?? '알 수 없는 오류가 발생했습니다.');
      } else if (data.candidates) {
        setCandidates(data.candidates);
      } else {
        setResult(data);
      }
    } catch {
      setOverviewError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchEtfComponents(q: string) {
    setLoading(true);
    setEtfError(null);
    setEtfComponents(null);
    setEtfComponentCount(0);
    setEtfCachedAt(null);
    setSelectedComponent(null);
    setCandidates([]);
    setSuggestions([]);
    setShowSuggestions(false);

    const trimmed = q.trim();

    try {
      let ticker = trimmed;

      // 이름으로 검색한 경우 종목코드 먼저 조회
      if (!CODE_RE.test(trimmed)) {
        const stockRes  = await fetch(`/api/stock?query=${encodeURIComponent(trimmed)}`);
        const stockData = await stockRes.json();

        if (!stockRes.ok) {
          setEtfError(stockData.error ?? '종목을 찾을 수 없습니다.');
          return;
        }
        if (stockData.candidates) {
          setCandidates(stockData.candidates);
          return;
        }
        ticker = stockData.ticker;
      }

      const res  = await fetch(`/api/etf-components?ticker=${encodeURIComponent(ticker)}`);
      const data = await res.json();

      if (!res.ok) {
        setEtfError(data.error ?? '알 수 없는 오류가 발생했습니다.');
      } else if (data.components.length === 0) {
        const count: number = data.componentCount ?? 0;
        setEtfError(
          count > 0
            ? `구성종목 ${count}개가 있으나 현재 시세 정보를 불러올 수 없습니다.\n해외 종목으로 구성된 ETF이거나, 국내 증시 운영 시간(평일 09:00–15:30)에 다시 시도하세요.`
            : 'ETF/ETN 종목코드를 입력하세요.',
        );
      } else {
        setEtfComponents(data.components);
        setEtfComponentCount(data.componentCount ?? 0);
        setEtfCachedAt(data.cachedAt ?? null);
      }
    } catch {
      setEtfError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!query.trim()) return;
    if (highlighted >= 0 && suggestions[highlighted]) {
      selectSuggestion(suggestions[highlighted]);
    } else {
      activeTab === 'etf' ? fetchEtfComponents(query) : fetchPrice(query);
    }
  }

  function selectSuggestion(s: StockCandidate) {
    justSelectedRef.current = true;
    setQuery(s.name);
    setSuggestions([]);
    setShowSuggestions(false);
    activeTab === 'etf' ? fetchEtfComponents(s.code) : fetchPrice(s.code);
  }

  function selectCandidate(c: StockCandidate) {
    setQuery(c.code);
    activeTab === 'etf' ? fetchEtfComponents(c.code) : fetchPrice(c.code);
  }

  async function fetchRank(type: 'hts' | 'short-sale' | 'market-cap') {
    setRankSubTab(type);
    setRankLoading(true);
    setRankError(null);
    if (type === 'hts') setHtsItems(null);
    else if (type === 'short-sale') setShortSaleItems(null);
    else setMarketCapItems(null);

    try {
      const res  = await fetch(`/api/rank?type=${type}`);
      const data = await res.json();
      if (!res.ok) {
        setRankError(data.error ?? '조회 실패');
      } else if (type === 'hts') {
        setHtsItems(data.items);
      } else if (type === 'short-sale') {
        setShortSaleItems(data.items);
      } else {
        setMarketCapItems(data.items);
      }
    } catch {
      setRankError('네트워크 오류가 발생했습니다.');
    } finally {
      setRankLoading(false);
    }
  }

  function switchTab(tab: TabKey) {
    setActiveTab(tab);
    setCandidates([]);
    setSuggestions([]);
    setShowSuggestions(false);
    setHighlighted(-1);
  }

  function clearAll() {
    setQuery('');
    setResult(null);
    setCandidates([]);
    setSuggestions([]);
    setShowSuggestions(false);
    setOverviewError(null);
    setHighlighted(-1);
    setEtfComponents(null);
    setSelectedComponent(null);
    setEtfError(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, -1));
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setHighlighted(-1);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4" style={{ backgroundColor: '#cd6133' }}>

      {/* 탭 */}
      <div className="w-full max-w-md mb-6">
        <div className="flex gap-1 bg-white/10 p-1 rounded-xl">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => switchTab(tab.key)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-white text-orange-600 shadow-sm'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 공유 검색 입력 — Rank 탭에서는 숨김 */}
      <div className={`w-full max-w-md${activeTab === 'rank' ? ' hidden' : ''}`}>
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              placeholder={
                activeTab === 'etf'
                  ? 'ETF 종목코드 또는 종목명을 입력하세요.'
                  : '종목코드 또는 종목명을 입력하세요.'
              }
              className="w-full border border-gray-300 rounded-lg pl-4 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/60"
              disabled={loading}
            />

            {query && !loading && (
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); clearAll(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
                aria-label="초기화"
              >
                ×
              </button>
            )}

            {showSuggestions && (
              <ul className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 overflow-y-auto max-h-[320px]">
                {suggestions.map((s, i) => (
                  <li
                    key={s.code}
                    onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
                    className={`flex items-center justify-between px-4 py-2.5 cursor-pointer text-sm border-b border-gray-100 last:border-b-0 ${
                      i === highlighted ? 'bg-orange-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-gray-800 font-medium">{s.name}</span>
                    <span className="text-gray-400 text-xs">{s.code}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="bg-white/20 hover:bg-white/30 disabled:bg-white/10 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors border border-white/40"
          >
            {loading ? '조회 중...' : '검색'}
          </button>
        </form>
      </div>

      {/* 탭 컨텐츠 */}
      <div className="mt-6 w-full max-w-md">

        {/* 공통: 종목명 검색 중복 후보 목록 */}
        {candidates.length > 0 && (
          <div className="bg-white/10 border border-white/20 rounded-lg overflow-hidden mb-4">
            <p className="text-white/70 text-xs px-4 py-2 border-b border-white/10">
              검색 결과 {candidates.length}건 · 종목을 선택하세요
            </p>
            {candidates.map((c) => (
              <button
                key={c.code}
                onClick={() => selectCandidate(c)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/10 transition-colors text-left border-b border-white/10 last:border-b-0"
              >
                <span className="text-white font-medium">{c.name}</span>
                <span className="text-white/60 text-sm">{c.code}</span>
              </button>
            ))}
          </div>
        )}

        {/* 종목 개요 탭 */}
        {activeTab === 'overview' && (
          <>
            {overviewError && (
              <p className="text-white text-sm text-center bg-red-500/50 rounded-lg px-4 py-3">{overviewError}</p>
            )}
            {result && (
              <StockDetail name={result.name} ticker={result.ticker} />
            )}
          </>
        )}

        {/* ETF 종목 분해 탭 */}
        {activeTab === 'etf' && (
          <>
            {etfError && (
              <p className="text-white text-sm text-center bg-red-500/50 rounded-lg px-4 py-3 whitespace-pre-line">{etfError}</p>
            )}

            {/* 구성종목 목록 */}
            {etfComponents !== null && selectedComponent === null && (
              <div className="bg-white/10 border border-white/20 rounded-lg overflow-hidden">
                <p className="text-white/70 text-xs px-4 py-2 border-b border-white/10">
                  구성종목 {etfComponents.length}개
                  {etfComponentCount > etfComponents.length && (
                    <span className="ml-1 text-white/40">/ 전체 {etfComponentCount}개</span>
                  )}
                  {etfComponents.some(c => !c.isDomestic) && (
                    <span className="ml-2 text-white/40">· 해외 종목은 이름만 표시</span>
                  )}
                  {etfCachedAt !== null && (
                    <span className="ml-2 text-yellow-300/70">
                      · 마지막 장 기준 ({new Date(etfCachedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} {new Date(etfCachedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })})
                    </span>
                  )}
                </p>
                {etfComponents.map((c, i) => {
                  const inner = (
                    <>
                      {/* 비중 */}
                      <span className="w-12 text-right text-white/40 text-xs shrink-0">
                        {parseFloat(c.weight).toFixed(1)}%
                      </span>
                      {/* 종목명 + 코드 */}
                      <div className="flex-1 min-w-0">
                        <span className="text-white text-sm font-medium truncate block">{c.name}</span>
                        <span className="text-white/40 text-xs">
                          {c.isDomestic ? c.code : '해외 종목'}
                        </span>
                      </div>
                    </>
                  );

                  return c.isDomestic ? (
                    <button
                      key={c.code || i}
                      onClick={() => setSelectedComponent(c)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 transition-colors text-left border-b border-white/10 last:border-b-0"
                    >
                      {inner}
                    </button>
                  ) : (
                    <div
                      key={c.name + i}
                      className="w-full flex items-center gap-3 px-4 py-3 border-b border-white/10 last:border-b-0 opacity-50"
                    >
                      {inner}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 구성종목 클릭 시 상세 보기 */}
            {selectedComponent !== null && (
              <>
                <button
                  onClick={() => setSelectedComponent(null)}
                  className="text-white/60 hover:text-white text-sm mb-3 flex items-center gap-1 transition-colors"
                >
                  ← ETF 목록으로
                </button>
                <StockDetail
                  name={selectedComponent.name}
                  ticker={selectedComponent.code}
                />
              </>
            )}
          </>
        )}

        {/* Rank 탭 */}
        {activeTab === 'rank' && (
          <>
            {/* 버튼 그룹 */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => fetchRank('hts')}
                disabled={rankLoading}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors border ${
                  rankSubTab === 'hts'
                    ? 'bg-white text-orange-600 border-white'
                    : 'bg-white/20 hover:bg-white/30 text-white border-white/40'
                } disabled:opacity-50`}
              >
                HTS조회
              </button>
              <button
                onClick={() => fetchRank('short-sale')}
                disabled={rankLoading}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors border ${
                  rankSubTab === 'short-sale'
                    ? 'bg-white text-orange-600 border-white'
                    : 'bg-white/20 hover:bg-white/30 text-white border-white/40'
                } disabled:opacity-50`}
              >
                공매도
              </button>
              <button
                onClick={() => fetchRank('market-cap')}
                disabled={rankLoading}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors border ${
                  rankSubTab === 'market-cap'
                    ? 'bg-white text-orange-600 border-white'
                    : 'bg-white/20 hover:bg-white/30 text-white border-white/40'
                } disabled:opacity-50`}
              >
                시가총액
              </button>
            </div>

            {rankLoading && (
              <p className="text-white/70 text-sm text-center py-4">조회 중...</p>
            )}

            {rankError && (
              <p className="text-white text-sm text-center bg-red-500/50 rounded-lg px-4 py-3">{rankError}</p>
            )}

            {/* HTS조회 결과 */}
            {!rankLoading && rankSubTab === 'hts' && htsItems && (
              <div className="bg-white/10 border border-white/20 rounded-lg overflow-hidden">
                <p className="text-white/70 text-xs px-4 py-2 border-b border-white/10">
                  HTS 조회 상위 {htsItems.length}종목
                </p>
                {htsItems.map((item) => (
                  <div
                    key={item.code}
                    className="flex items-center gap-3 px-4 py-2.5 border-b border-white/10 last:border-b-0"
                  >
                    <span className="w-6 text-right text-white/40 text-xs shrink-0">{item.rank}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                      item.market === '코스피' ? 'bg-blue-500/30 text-blue-200' : 'bg-green-500/30 text-green-200'
                    }`}>
                      {item.market}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-white text-sm font-medium block truncate">{item.name}</span>
                    </div>
                    <span className="text-white/40 text-xs shrink-0">{item.code}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 시가총액 결과 */}
            {!rankLoading && rankSubTab === 'market-cap' && marketCapItems && (
              <div className="bg-white/10 border border-white/20 rounded-lg overflow-hidden">
                <p className="text-white/70 text-xs px-4 py-2 border-b border-white/10">
                  시가총액 상위 {marketCapItems.length}종목
                </p>
                {marketCapItems.map((item) => {
                  const isUp   = item.prdyVrssSign === '2' || item.prdyVrssSign === '1';
                  const isDown = item.prdyVrssSign === '5' || item.prdyVrssSign === '4';
                  const priceColor = isUp ? 'text-red-300' : isDown ? 'text-blue-300' : 'text-white/70';
                  const prefix = isUp ? '+' : '';
                  const avlsTr = parseInt(item.stckAvls, 10);
                  const avlsLabel = avlsTr >= 10000
                    ? `${(avlsTr / 10000).toFixed(1)}조`
                    : `${avlsTr.toLocaleString()}억`;
                  return (
                    <div
                      key={item.code}
                      className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10 last:border-b-0"
                    >
                      <span className="w-5 text-right text-white/40 text-xs shrink-0">{item.rank}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-white text-sm font-medium block truncate">{item.name}</span>
                        <span className="text-white/40 text-xs">시총 {avlsLabel} · 비중 {parseFloat(item.mrktWholAvlsRlim).toFixed(2)}%</span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`text-sm font-medium block ${priceColor}`}>
                          {Number(item.price).toLocaleString()}
                        </span>
                        <span className={`text-xs ${priceColor}`}>
                          {prefix}{item.prdyCtrt}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 공매도 결과 */}
            {!rankLoading && rankSubTab === 'short-sale' && shortSaleItems && (
              <div className="bg-white/10 border border-white/20 rounded-lg overflow-hidden">
                <p className="text-white/70 text-xs px-4 py-2 border-b border-white/10">
                  공매도 상위 {shortSaleItems.length}종목
                </p>
                {shortSaleItems.map((item) => {
                  const isUp   = item.prdyVrssSign === '2' || item.prdyVrssSign === '1';
                  const isDown = item.prdyVrssSign === '5' || item.prdyVrssSign === '4';
                  const priceColor = isUp ? 'text-red-300' : isDown ? 'text-blue-300' : 'text-white/70';
                  const prefix = isUp ? '+' : '';
                  return (
                    <div
                      key={item.code}
                      className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10 last:border-b-0"
                    >
                      <span className="w-5 text-right text-white/40 text-xs shrink-0">{item.rank}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-white text-sm font-medium block truncate">{item.name}</span>
                        <span className="text-white/40 text-xs">공매도비중 {parseFloat(item.sstsVolRlim).toFixed(2)}%</span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`text-sm font-medium block ${priceColor}`}>
                          {Number(item.price).toLocaleString()}
                        </span>
                        <span className={`text-xs ${priceColor}`}>
                          {prefix}{item.prdyCtrt}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

      </div>
    </main>
  );
}
