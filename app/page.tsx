// 종목 현재가 검색 메인 페이지

'use client';

import { useState, FormEvent } from 'react';

interface StockResult {
  name: string;
  price: string;
  ticker: string;
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<StockResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/stock?query=${encodeURIComponent(query.trim())}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? '알 수 없는 오류가 발생했습니다.');
      } else {
        setResult(data);
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
      <h1 className="text-2xl font-semibold text-gray-800 mb-8">주식 현재가 조회</h1>

      <form onSubmit={handleSearch} className="w-full max-w-md flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="종목명 또는 종목코드 입력"
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
        >
          {loading ? '조회 중...' : '검색'}
        </button>
      </form>

      <div className="mt-8 w-full max-w-md">
        {error && (
          <p className="text-red-500 text-sm text-center">{error}</p>
        )}

        {result && (
          <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-6 py-4">
            <span className="text-gray-800 font-medium">{result.name}</span>
            <span className="text-blue-600 font-semibold text-lg">
              {Number(result.price).toLocaleString()}원
            </span>
          </div>
        )}
      </div>
    </main>
  );
}
