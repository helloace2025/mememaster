"use client";

import { useEffect, useRef, useState } from "react";
import {
  clearAgentLogs,
  getAgentLogs,
  getAgentSessions,
  isAgentTerminalOpen,
  setAgentTerminalOpen,
  subscribeAgentLog,
  type AgentLogEntry,
  type AgentSession,
  latestLogLine,
  currentRunningSession,
} from "@/lib/agentLog";
import TypewriterText from "@/components/TypewriterText";
import { useI18n } from "@/lib/i18n/I18nProvider";

/** Okara-style line prefix */
function linePrefix(level: AgentLogEntry["level"]) {
  switch (level) {
    case "ok":
      return { mark: "✓", cls: "text-emerald-400" };
    case "err":
      return { mark: "✗", cls: "text-rose-400" };
    case "warn":
      return { mark: "!", cls: "text-amber-300" };
    case "run":
      return { mark: ">", cls: "text-white/70" };
    default:
      return { mark: ">", cls: "text-white/50" };
  }
}

function lineTextClass(level: AgentLogEntry["level"]) {
  switch (level) {
    case "ok":
      return "text-emerald-400";
    case "err":
      return "text-rose-400";
    case "warn":
      return "text-amber-200";
    case "run":
      return "text-white/90";
    default:
      return "text-white/75";
  }
}

function useAgentTerminalState() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set());
  const bootstrapped = useRef(false);

  useEffect(() => {
    const sync = () => {
      setOpen(isAgentTerminalOpen());
      const next = [...getAgentLogs()];
      setLogs(next);
      setSessions([...getAgentSessions()]);
      if (!bootstrapped.current) {
        bootstrapped.current = true;
        setSeenIds(new Set(next.map((l) => l.id)));
      }
    };
    sync();
    return subscribeAgentLog(sync);
  }, []);

  useEffect(() => {
    if (!logs.length) return;
    const fresh = logs.filter((l) => !seenIds.has(l.id));
    if (!fresh.length) return;
    const t = window.setTimeout(() => {
      setSeenIds((prev) => {
        const n = new Set(prev);
        fresh.forEach((l) => n.add(l.id));
        return n;
      });
    }, 550);
    return () => window.clearTimeout(t);
  }, [logs, seenIds]);

  const running = currentRunningSession();
  const latest = latestLogLine();
  const busy = !!running;
  const statusText = busy
    ? running!.title
    : latest
      ? latest.message
      : "agent idle · ready";

  return { open, logs, sessions, seenIds, busy, statusText, latest };
}

/** Chip in the top bar row — toggles the full-width drawer */
export function AgentTerminalTrigger() {
  const { open, busy, statusText } = useAgentTerminalState();
  const { t } = useI18n();

  return (
    <button
      type="button"
      onClick={() => setAgentTerminalOpen(!open)}
      className="group flex min-w-0 max-w-full items-center gap-2 rounded-md border border-zinc-600/90 bg-black/40 px-2.5 py-1 text-left font-mono transition hover:border-zinc-400 hover:bg-black/60"
      title={t("agent.logTitle")}
    >
      <span
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
          busy
            ? "animate-pulse bg-emerald-400 shadow-[0_0_6px_#34d399]"
            : "bg-zinc-400"
        }`}
      />
      <span className="hidden text-[10px] font-medium text-white/90 sm:inline">
        mm@agent
      </span>
      <span className="text-[10px] text-emerald-400">›</span>
      <span
        className={`min-w-0 flex-1 truncate text-[11px] font-medium tracking-tight ${
          busy ? "text-emerald-300" : "text-white"
        }`}
      >
        <TypewriterText
          text={statusText}
          speed={busy ? 14 : 16}
          forceCaret={busy}
          className="truncate"
        />
      </span>
      <span className="shrink-0 text-[10px] text-white/50 group-hover:text-white/80">
        {open ? "▾" : "▸"}
      </span>
    </button>
  );
}

/**
 * Black header expands downward. Narrow left-aligned log (Okara style):
 * ✓ / > / ✗ + message, sequential drop-in, scroll when long.
 */
export function AgentTerminalDrawer() {
  const { open, logs, seenIds, busy, latest } = useAgentTerminalState();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [logs, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAgentTerminalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div
      className={`mm-term-drawer grid border-t border-zinc-800/60 transition-[grid-template-rows] duration-300 ease-out ${
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">
        {/* ~ half of previous max-w-3xl (768→384), left-aligned under logo/trigger */}
        <div className="w-full max-w-[22rem] px-3 pb-2.5 pt-2 sm:max-w-[24rem] sm:px-4">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-mono text-[10px] text-white/70">
              <span className="text-emerald-400">●</span>
              <span className="text-white/80">agent terminal</span>
              {busy && (
                <span className="mm-term-pulse text-emerald-400">running</span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => clearAgentLogs()}
                className="rounded px-1 py-0.5 font-mono text-[10px] text-white/40 hover:text-white"
              >
                clear
              </button>
              <button
                type="button"
                onClick={() => setAgentTerminalOpen(false)}
                className="rounded px-1 py-0.5 font-mono text-[10px] text-white/40 hover:text-white"
              >
                esc
              </button>
            </div>
          </div>

          {/* sequential log — left aligned, Okara style */}
          <div
            ref={scrollRef}
            className="mm-term-scroll max-h-[min(36vh,300px)] overflow-y-auto overflow-x-hidden overscroll-contain font-mono text-[12px] leading-[1.65]"
          >
            {logs.length === 0 ? (
              <div className="space-y-0.5 text-white/45">
                <p>
                  <span className="text-white/40">&gt;</span> waiting for agent
                  tasks…
                </p>
                <p>
                  <span className="text-white/40">&gt;</span> hot list / twitter
                  / website will stream here
                </p>
              </div>
            ) : (
              logs.map((line, i) => {
                const { mark, cls } = linePrefix(line.level);
                const isNew = !seenIds.has(line.id);
                // stagger feel for newly arrived lines
                const delay =
                  isNew && i >= logs.length - 6
                    ? `${Math.min(5, logs.length - 1 - i) * 40}ms`
                    : undefined;
                return (
                  <div
                    key={line.id}
                    className={`flex items-start gap-2 text-left ${
                      isNew ? "mm-term-line-in" : ""
                    }`}
                    style={delay ? { animationDelay: delay } : undefined}
                  >
                    <span
                      className={`w-3 shrink-0 select-none pt-px text-center ${cls}`}
                    >
                      {mark}
                    </span>
                    <span
                      className={`min-w-0 flex-1 break-words text-left ${lineTextClass(
                        line.level
                      )}`}
                    >
                      {line.message}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {latest && (
            <div className="mt-2 truncate border-t border-zinc-800/80 pt-1.5 font-mono text-[10px] text-white/40">
              <TypewriterText
                text={latest.message}
                speed={12}
                forceCaret={busy}
                className="text-white/55"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AgentTerminal() {
  return <AgentTerminalTrigger />;
}
