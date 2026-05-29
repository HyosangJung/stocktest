import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "주식 현재가 조회",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
