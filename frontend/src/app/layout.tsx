import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { I18nProvider } from "@/lib/i18n/I18nProvider";

export const metadata: Metadata = {
  title: "MemeMaster · 选题共创副驾驶",
  description:
    "看板扫热门 · 分析工作台 · 共创对话 — 研究教育，非投资建议",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {/* Runs before app JS: MetaMask extension noise must not crash Next overlay */}
        <Script
          src="/suppress-ext-noise.js"
          strategy="beforeInteractive"
        />
        <I18nProvider>
          <AppShell>{children}</AppShell>
        </I18nProvider>
      </body>
    </html>
  );
}
