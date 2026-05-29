// 종목 현재가 검색 메인 페이지

'use client';

import { useState, useEffect, useRef } from 'react';

interface StockResult {
  name: string;
  price: string;
  ticker: string;
}

interface Candidate {
  name: string;
  code: string;
}

export default function Home() {
  const [query, setQuery]           = useState('');
  const [result, setResult]         = useState<StockResult | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [suggestions, setSuggestions] = useState<Candidate[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [error, setError]           = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justSelectedRef = useRef(false); // 종목 선택 직후 재조회 드롭다운을 200ms 뒤 자동 숨김

  // 키 입력마다 자동완성 후보 조회 (200ms 디바운스)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = query.trim();
    if (!q || /^\d{6}$/.test(q)) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      if (justSelectedRef.current) {
        justSelectedRef.current = false;
        return;
      }
      try {
        const res  = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setSuggestions(data.suggestions ?? []);
        setShowSuggestions((data.suggestions ?? []).length > 0);
        setHighlighted(-1);
      } catch {
        // 자동완성 오류는 무시
      }
    }, 200);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  async function fetchPrice(q: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    setCandidates([]);
    setSuggestions([]);
    setShowSuggestions(false);

    try {
      const res  = await fetch(`/api/stock?query=${encodeURIComponent(q.trim())}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? '알 수 없는 오류가 발생했습니다.');
      } else if (data.candidates) {
        setCandidates(data.candidates);
      } else {
        setResult(data);
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!query.trim()) return;
    if (highlighted >= 0 && suggestions[highlighted]) {
      const s = suggestions[highlighted];
      setQuery(s.name);
      fetchPrice(s.code);
    } else {
      fetchPrice(query);
    }
  }

  function selectSuggestion(s: Candidate) {
    justSelectedRef.current = true;
    setQuery(s.name);
    setSuggestions([]);
    setShowSuggestions(false);
    fetchPrice(s.code);
  }

  function selectCandidate(c: Candidate) {
    setQuery(c.code);
    fetchPrice(c.code);
  }

  function clearAll() {
    setQuery('');
    setResult(null);
    setCandidates([]);
    setSuggestions([]);
    setShowSuggestions(false);
    setError(null);
    setHighlighted(-1);
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
      <h1 className="text-2xl font-semibold text-white mb-8">주식 현재가 조회</h1>

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
              placeholder="종목코드(005930) 또는 종목명(삼성전자)"
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

      <p className="mt-2 text-xs text-white/60">
        삼성전자 005930 · SK하이닉스 000660 · 카카오 035720 · NAVER 035420
      </p>

      <div className="mt-6 w-full max-w-md">
        {error && (
          <p className="text-white text-sm text-center bg-red-500/50 rounded-lg px-4 py-3">{error}</p>
        )}

        {candidates.length > 0 && (
          <div className="bg-white/10 border border-white/20 rounded-lg overflow-hidden">
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

        {result && (
          <div className="flex items-center justify-between bg-white/10 border border-white/20 rounded-lg px-6 py-4">
            <div>
              <span className="text-white font-medium">{result.name}</span>
              <span className="text-white/50 text-xs ml-2">{result.ticker}</span>
            </div>
            <span className="text-white font-semibold text-lg">
              {Number(result.price).toLocaleString()}원
            </span>
          </div>
        )}
      </div>
    </main>
  );
}
