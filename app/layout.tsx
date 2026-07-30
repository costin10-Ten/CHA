import type { Metadata } from "next";
import { Noto_Sans_TC } from "next/font/google";

import "./globals.css";

const notoSansTC = Noto_Sans_TC({
  variable: "--font-noto-sans-tc",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "個人知識庫與風險溝通產製系統",
    template: "%s｜個人知識庫",
  },
  description:
    "以核定事實為基礎的個人知識庫：來源保存、候選事實審核、混合搜尋、AI 問答逐句驗證與風險溝通素材產製。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-TW">
      <body className={`${notoSansTC.variable} antialiased`}>{children}</body>
    </html>
  );
}
