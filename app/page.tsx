// 종목 현재가 검색 메인 페이지

'use client';

import { useState } from 'react';

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
  const [error, setError]           = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);

  async function fetchPrice(q: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    setCandidates([]);

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
    fetchPrice(query);
  }

  function selectCandidate(c: Candidate) {
    setQuery(c.code);
    fetchPrice(c.code);
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4" style={{ backgroundColor: '#cd6133' }}>
      <h1 className="text-2xl font-semibold text-white mb-8">주식 현재가 조회</h1>

      <form onSubmit={handleSearch} className="w-full max-w-md flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="종목코드(005930) 또는 종목명(삼성전자)"
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/60"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="bg-white/20 hover:bg-white/30 disabled:bg-white/10 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors border border-white/40"
        >
          {loading ? '조회 중...' : '검색'}
        </button>
      </form>

      <p className="mt-2 text-xs text-white/60">
        삼성전자 005930 · SK하이닉스 000660 · 카카오 035720 · NAVER 035420
      </p>

      <div className="mt-6 w-full max-w-md">
        {error && (
          <p className="text-white text-sm text-center bg-red-500/50 rounded-lg px-4 py-3">{error}</p>
        )}

        {/* 종목명 검색 시 후보 목록 */}
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

        {/* 조회 결과 */}
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
