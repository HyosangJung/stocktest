import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "종목 개요",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
