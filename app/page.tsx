// 종목 개요 · ETF 종목 분해 탭을 제공하는 메인 페이지

'use client';

import { useState, useEffect, useRef } from 'react';
import StockDetail from '@/app/components/StockDetail';
import type { StockCandidate } from '@/lib/stockMaster';
import type { EtfComponent } from '@/app/api/etf-components/route';

interface StockResult {
  name: string;
  price: string;
  ticker: string;
}

type TabKey = 'overview' | 'etf';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '종목 개요' },
  { key: 'etf', label: 'ETF 종목 분해' },
];

// 클라이언트에서 포맷 검증용 (서버 kisClient와 동일 패턴)
const CODE_RE = /^[A-Z0-9]{6}$/i;
const SUGGEST_CACHE_MAX = 100;

function getChangeColor(sign: string): string {
  if (sign === '1' || sign === '2') return 'text-red-300';
  if (sign === '4' || sign === '5') return 'text-blue-300';
  return 'text-white/40';
}

function formatChangeRate(sign: string, rate: string): string {
  const abs = Math.abs(parseFloat(rate) || 0).toFixed(2);
  if (sign === '1' || sign === '2') return `+${abs}%`;
  if (sign === '4' || sign === '5') return `-${abs}%`;
  return `${abs}%`;
}

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

  // ETF 종목 분해 탭 상태
  const [etfComponents, setEtfComponents]         = useState<EtfComponent[] | null>(null);
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

      {/* 공유 검색 입력 */}
      <div className="w-full max-w-md">
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
              <StockDetail name={result.name} price={result.price} ticker={result.ticker} />
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
                  {etfComponents.some(c => !c.isDomestic) && (
                    <span className="ml-2 text-white/40">· 해외 종목은 이름만 표시</span>
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
                      {/* 국내 종목: 현재가 + 등락률 / 해외 종목: 표시 없음 */}
                      {c.isDomestic && (
                        <div className="text-right shrink-0">
                          <div className="text-white text-sm">{Number(c.price).toLocaleString()}원</div>
                          <div className={`text-xs ${getChangeColor(c.changeSign)}`}>
                            {formatChangeRate(c.changeSign, c.changeRate)}
                          </div>
                        </div>
                      )}
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
                  price={selectedComponent.price}
                  ticker={selectedComponent.code}
                />
              </>
            )}
          </>
        )}

      </div>
    </main>
  );
}
