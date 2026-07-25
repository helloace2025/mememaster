export function fmtUsd(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toPrecision(2)}`;
  return `$${n.toFixed(2)}`;
}

export function fmtPct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function shortAddr(a?: string) {
  if (!a) return "";
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** human age from hours */
export function fmtAge(hours?: number | null): string {
  if (hours == null || Number.isNaN(hours)) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  const d = hours / 24;
  return `${d.toFixed(d < 10 ? 1 : 0)}d`;
}

export function scoreTone(score?: number) {
  if (score == null) return "text-zinc-400";
  if (score >= 7) return "text-emerald-600";
  if (score >= 4) return "text-amber-600";
  return "text-rose-600";
}

export function friendlyFetchError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed|无法连接|ECONNREFUSED/i.test(msg)) {
    return "连不上后端 API（127.0.0.1:8000）。请先启动后端服务。";
  }
  return msg;
}
