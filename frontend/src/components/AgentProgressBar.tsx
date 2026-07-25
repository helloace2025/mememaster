"use client";

import { useEffect, useState } from "react";
import {
  getAgentProgress,
  subscribeAgentLog,
  type AgentProgress,
} from "@/lib/agentLog";

/**
 * Slim progress line under the top bar — shows agent work without opening the drawer.
 */
export default function AgentProgressBar() {
  const [p, setP] = useState<AgentProgress>(getAgentProgress());

  useEffect(() => {
    return subscribeAgentLog(() => setP({ ...getAgentProgress() }));
  }, []);

  const visible = p.active || p.finishing;
  if (!visible) {
    return <div className="h-0.5 w-full bg-transparent" aria-hidden />;
  }

  const indeterminate = p.active && p.total <= 0;
  const pct =
    p.total > 0
      ? Math.min(100, Math.round((p.done / p.total) * 100))
      : p.finishing
        ? 100
        : 0;

  return (
    <div
      className="relative h-0.5 w-full overflow-hidden bg-zinc-800"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
      aria-label={p.label || "agent progress"}
      title={
        p.label
          ? p.total > 0
            ? `${p.label} · ${p.done}/${p.total}`
            : p.label
          : "working…"
      }
    >
      {indeterminate ? (
        <div className="mm-progress-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
      ) : (
        <div
          className={`h-full rounded-r-full transition-[width] duration-300 ease-out ${
            p.finishing
              ? "bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.8)]"
              : "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.55)]"
          }`}
          style={{ width: `${Math.max(pct, p.active && pct === 0 ? 6 : pct)}%` }}
        />
      )}
    </div>
  );
}
