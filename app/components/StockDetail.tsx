// 종목 현재가 카드와 차트를 함께 표시하는 공유 컴포넌트 (종목 개요 · ETF 탭에서 재사용)

import StockChart from '@/app/components/StockChart';

interface Props {
  name: string;
  price: string;
  ticker: string;
}

export default function StockDetail({ name, price, ticker }: Props) {
  return (
    <>
      <div className="flex items-center justify-between bg-white/10 border border-white/20 rounded-lg px-6 py-4">
        <div>
          <span className="text-white font-medium">{name}</span>
          <span className="text-white/50 text-xs ml-2">{ticker}</span>
        </div>
        <span className="text-white font-semibold text-lg">
          {Number(price).toLocaleString()}원
        </span>
      </div>
      <StockChart ticker={ticker} name={name} />
    </>
  );
}
