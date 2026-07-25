"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getHealth } from "@/lib/api";
import type { Health } from "@/lib/types";
import {
  AgentTerminalDrawer,
  AgentTerminalTrigger,
} from "@/components/AgentTerminal";
import AgentProgressBar from "@/components/AgentProgressBar";
import DevOverlayFilter from "@/components/DevOverlayFilter";

/**
 * App chrome: black header + agent log drawer + status pills.
 * Wallet connect removed — not needed for research MVP and MetaMask noise.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, [pathname]);

  const isBoard = pathname === "/";
  const isChat = pathname?.startsWith("/chat");
  const isToken = pathname?.startsWith("/token/");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <DevOverlayFilter />
      <header className="shrink-0 border-b border-zinc-800 bg-zinc-950 text-white">
        <div className="flex h-11 items-center gap-2 px-3 sm:gap-3 sm:px-4">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2"
            title="MemeMaster"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500 font-mono text-[11px] font-bold text-black shadow-[0_0_10px_rgba(16,185,129,0.45)]">
              M
            </span>
            <span className="hidden font-mono text-[12px] font-semibold tracking-tight text-white md:inline">
              MemeMaster
            </span>
          </Link>

          <div className="min-w-0 flex-1">
            <AgentTerminalTrigger />
          </div>

          <nav className="hidden items-center gap-0.5 sm:flex">
            <TopLink href="/" active={isBoard || !!isToken} label="看板" />
            <TopLink href="/chat" active={!!isChat} label="对话" />
          </nav>

          <div className="flex shrink-0 items-center gap-1.5">
            <Pill ok={!!health?.gmgn_key} label="GMGN" />
            <Pill ok={!!health?.opennews_token} label="6551" />
            <Pill ok={!!health?.llm_key} label="LLM" />
          </div>
        </div>

        <AgentProgressBar />
        <AgentTerminalDrawer />
      </header>

      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-zinc-200 bg-white px-3 sm:hidden">
        <TopLink href="/" active={isBoard || !!isToken} label="看板" light />
        <TopLink href="/chat" active={!!isChat} label="对话" light />
      </div>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}

function TopLink({
  href,
  active,
  label,
  light,
}: {
  href: string;
  active: boolean;
  label: string;
  light?: boolean;
}) {
  if (light) {
    return (
      <Link
        href={href}
        className={`rounded-md px-2.5 py-0.5 text-[12px] font-medium transition ${
          active
            ? "bg-zinc-100 text-zinc-900"
            : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
        }`}
      >
        {label}
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-medium transition ${
        active
          ? "bg-white/10 text-white ring-1 ring-white/20"
          : "text-white/55 hover:bg-white/5 hover:text-white"
      }`}
    >
      {label}
    </Link>
  );
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`hidden rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wide sm:inline ${
        ok
          ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/40"
          : "bg-white/5 text-white/35 ring-1 ring-white/10"
      }`}
    >
      {label}
    </span>
  );
}
