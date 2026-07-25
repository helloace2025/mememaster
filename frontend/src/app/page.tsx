"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { saveFocusToken } from "@/lib/api";
import {
  formatCacheAge,
  isHotCacheFresh,
  loadHotCached,
  loadHotUiPrefs,
  peekHotCache,
  saveHotUiPrefs,
  HOT_CACHE_TTL_MS,
} from "@/lib/hotCache";
import { ALL_CHAIN_IDS, CHAINS, type Token } from "@/lib/types";
import { fmtAge, fmtPct, fmtUsd, shortAddr } from "@/lib/format";
import {
  agentLog,
  endAgentSession,
  startAgentSession,
} from "@/lib/agentLog";

const AGE_OPTIONS = [
  { id: "24h", label: "24h 内" },
  { id: "3d", label: "3 天内" },
  { id: "7d", label: "7 天内" },
  { id: "14d", label: "14 天内" },
  { id: "30d", label: "30 天内" },
  { id: "all", label: "不限（含老币）" },
] as const;

export default function DashboardPage() {
  const prefs = typeof window !== "undefined" ? loadHotUiPrefs() : {};
  const [chain, setChain] = useState(prefs.chain || "sol");
  const [interval, setInterval] = useState(
    ["1h", "6h", "24h"].includes(prefs.interval || "")
      ? (prefs.interval as string)
      : "24h"
  );
  const [limit, setLimit] = useState(
    [20, 50, 100].includes(Number(prefs.limit)) ? Number(prefs.limit) : 50
  );
  const [maxCreated, setMaxCreated] = useState(
    AGE_OPTIONS.some((o) => o.id === prefs.maxCreated)
      ? (prefs.maxCreated as string)
      : "7d"
  );
  const [loading, setLoading] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [byChain, setByChain] = useState<Record<string, Token[]>>({});
  const [chainErrors, setChainErrors] = useState<Record<string, string>>({});
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [q, setQ] = useState("");
  const [, setTick] = useState(0);

  // hydrate from cache instantly
  useEffect(() => {
    const cached = peekHotCache({
      interval,
      limit,
      maxCreated,
      chains: [...ALL_CHAIN_IDS],
    });
    if (cached) {
      setByChain(cached.byChain);
      setChainErrors(cached.chainErrors);
      setFetchedAt(cached.fetchedAt);
      setFromCache(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyPayload = useCallback(
    (
      payload: {
        byChain: Record<string, Token[]>;
        chainErrors: Record<string, string>;
        fetchedAt: number;
      },
      cached: boolean
    ) => {
      setByChain(payload.byChain);
      setChainErrors(payload.chainErrors);
      setFetchedAt(payload.fetchedAt);
      setFromCache(cached);
    },
    []
  );

  const load = useCallback(
    async (force = false) => {
      setError(null);
      const hasRows = Object.values(byChain).some((t) => t.length > 0);
      if (force || !hasRows) setLoading(true);
      else setRevalidating(true);

      const sid = startAgentSession(
        force ? "刷新全链热门代币" : "抓取全链热门代币",
        1
      );
      agentLog(
        "gmgn",
        `拉取热门 · interval=${interval} · age=${maxCreated} · limit=${limit}`,
        "run"
      );
      agentLog(
        "gmgn",
        `chains: ${ALL_CHAIN_IDS.join(", ")}`,
        "info"
      );

      try {
        const { payload, fromCache: fc, revalidating: rv } = await loadHotCached({
          interval,
          limit,
          maxCreated,
          chains: [...ALL_CHAIN_IDS],
          force,
        });
        applyPayload(payload, fc);
        setRevalidating(rv);

        const total = Object.values(payload.byChain).reduce(
          (n, arr) => n + (arr?.length || 0),
          0
        );
        const errChains = Object.entries(payload.chainErrors || {})
          .filter(([, msg]) => msg)
          .map(([c]) => c);

        if (fc) {
          agentLog("gmgn", `命中本地缓存 · ${total} tokens`, "ok");
        } else {
          agentLog("gmgn", `GMGN 返回 · ${total} tokens`, "ok");
        }
        for (const c of ALL_CHAIN_IDS) {
          const n = payload.byChain[c]?.length ?? 0;
          const err = payload.chainErrors?.[c];
          if (err) agentLog(c, `失败: ${err}`, "err");
          else agentLog(c, `${n} 条`, n ? "ok" : "warn");
        }
        if (errChains.length) {
          agentLog("gmgn", `部分链失败: ${errChains.join(", ")}`, "warn");
        }

        if (rv && !force) {
          agentLog("gmgn", "后台静默刷新中…", "run");
          const started = payload.fetchedAt;
          const timer = window.setInterval(() => {
            const next = peekHotCache({
              interval,
              limit,
              maxCreated,
              chains: [...ALL_CHAIN_IDS],
            });
            if (next && next.fetchedAt > started) {
              applyPayload(next, false);
              setRevalidating(false);
              window.clearInterval(timer);
              const n2 = Object.values(next.byChain).reduce(
                (n, arr) => n + (arr?.length || 0),
                0
              );
              agentLog("gmgn", `后台刷新完成 · ${n2} tokens`, "ok");
              endAgentSession(sid, "done", "热门面板就绪");
            }
          }, 800);
          window.setTimeout(() => {
            window.clearInterval(timer);
            setRevalidating(false);
            endAgentSession(sid, "done", "热门面板就绪（后台刷新超时后结束）");
          }, 25000);
        } else {
          endAgentSession(sid, "done", "热门面板就绪");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        agentLog("gmgn", `抓取失败: ${msg}`, "err");
        endAgentSession(sid, "error", "热门抓取失败");
        if (!hasRows) {
          setError(msg);
        } else {
          setError(`刷新失败，仍显示缓存：${msg}`);
        }
        setRevalidating(false);
      } finally {
        setLoading(false);
      }
    },
    [interval, limit, maxCreated, byChain, applyPayload]
  );

  useEffect(() => {
    saveHotUiPrefs({ chain, interval, limit, maxCreated });
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval, limit, maxCreated]);

  useEffect(() => {
    saveHotUiPrefs({ chain, interval, limit, maxCreated });
  }, [chain, interval, limit, maxCreated]);

  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 15000);
    return () => window.clearInterval(t);
  }, []);

  const [hideDeadSocial, setHideDeadSocial] = useState(true);

  const tokens = useMemo(() => {
    let list = byChain[chain] || [];
    // 注销/乱码数字 ID 推特：默认隐藏，无分析价值
    if (hideDeadSocial) {
      list = list.filter(
        (t) => !(t.skip_research || t.twitter_status === "dead")
      );
    }
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (t) =>
        t.symbol?.toLowerCase().includes(needle) ||
        t.name?.toLowerCase().includes(needle) ||
        t.address?.toLowerCase().includes(needle)
    );
  }, [byChain, chain, q, hideDeadSocial]);

  const hiddenDeadCount = useMemo(() => {
    const list = byChain[chain] || [];
    return list.filter(
      (t) => t.skip_research || t.twitter_status === "dead"
    ).length;
  }, [byChain, chain]);

  const openToken = (t: Token) => {
    saveFocusToken(t);
  };

  const cacheLabel = useMemo(() => {
    if (!fetchedAt) return null;
    const age = formatCacheAge(fetchedAt);
    const fresh = isHotCacheFresh(fetchedAt, HOT_CACHE_TTL_MS);
    if (revalidating) return `缓存 ${age} · 后台更新中…`;
    if (fromCache && fresh) return `缓存 · ${age}`;
    if (fromCache && !fresh) return `缓存偏旧 · ${age}`;
    return `已更新 · ${age}`;
  }, [fetchedAt, fromCache, revalidating]);

  const hasData = Object.values(byChain).some((t) => t.length > 0);
  const ageLabel =
    AGE_OPTIONS.find((o) => o.id === maxCreated)?.label || maxCreated;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-white px-5">
        <div>
          <h1 className="text-sm font-semibold">看板 · 全链新币热门</h1>
          <p className="text-xs text-[var(--text-muted)]">
            默认过滤老币 · 聚焦新叙事（{ageLabel}）
            {cacheLabel && (
              <span className="ml-2 text-emerald-700">· {cacheLabel}</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading || revalidating}
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {loading || revalidating ? "刷新中…" : "强制刷新"}
        </button>
      </header>

      <div className="border-b border-[var(--border)] bg-white px-5 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap rounded-xl bg-zinc-100 p-1">
            {CHAINS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setChain(c.id)}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  chain === c.id
                    ? "bg-white font-medium shadow-sm"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                {c.label}
                <span className="ml-1 text-xs text-zinc-400">
                  {byChain[c.id]?.length ?? "—"}
                </span>
              </button>
            ))}
          </div>

          <select
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-sm font-medium text-emerald-900"
            value={maxCreated}
            onChange={(e) => setMaxCreated(e.target.value)}
            title="只看创建多久以内的币，过滤老牌高量币"
          >
            {AGE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                币龄 {o.label}
              </option>
            ))}
          </select>

          <select
            className="rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 text-sm"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            title="热度统计窗口（交易量/涨跌看多久）"
          >
            {["1h", "6h", "24h"].map((v) => (
              <option key={v} value={v}>
                热度 {v}
              </option>
            ))}
          </select>

          <select
            className="rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 text-sm"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {[20, 50, 100].map((v) => (
              <option key={v} value={v}>
                每链 {v}
              </option>
            ))}
          </select>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索 symbol / 名称 / CA"
            className="min-w-[160px] flex-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm outline-none focus:border-emerald-300"
          />
          <label
            className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[11px] text-zinc-600"
            title="推特已注销/只剩数字 ID 的盘，默认隐藏"
          >
            <input
              type="checkbox"
              checked={hideDeadSocial}
              onChange={(e) => setHideDeadSocial(e.target.checked)}
              className="rounded border-zinc-300"
            />
            隐藏失效 X
            {hiddenDeadCount > 0 && (
              <span className="text-zinc-400">({hiddenDeadCount})</span>
            )}
          </label>
        </div>
        <p className="mt-2 text-[11px] text-zinc-400">
          默认隐藏推特已注销（数字乱码 ID）的币。币龄过滤创建时间；热度是近期交易窗口。
        </p>
        {chainErrors[chain] && (
          <p className="mt-1 text-xs text-rose-600">{chainErrors[chain]}</p>
        )}
        {error && <p className="mt-1 text-sm text-rose-600">{error}</p>}
      </div>

      <div className="mm-scroll min-h-0 flex-1 overflow-auto p-5">
        {loading && !hasData && (
          <div className="mb-3 text-sm text-zinc-400">加载新币热门榜…</div>
        )}
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-[var(--shadow)]">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">代币</th>
                <th className="px-4 py-3 font-medium">币龄</th>
                <th className="px-4 py-3 font-medium">MCap</th>
                <th className="px-4 py-3 font-medium">Volume</th>
                <th className="px-4 py-3 font-medium">涨跌</th>
                <th className="px-4 py-3 font-medium">SM/KOL</th>
                <th className="px-4 py-3 font-medium">社交</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t, i) => {
                const chg = t.price_change_percent;
                return (
                  <tr
                    key={t.address}
                    className="border-t border-zinc-100 hover:bg-zinc-50/80"
                  >
                    <td className="px-4 py-3 text-zinc-400">
                      {t.rank ?? i + 1}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        {t.logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={t.logo}
                            alt=""
                            className="h-8 w-8 rounded-full bg-zinc-100 object-cover"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-zinc-100" />
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold">{t.symbol}</div>
                          <div className="truncate text-xs text-zinc-500">
                            {t.name}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-xs text-emerald-700">
                      {fmtAge(t.age_hours)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {fmtUsd(t.market_cap)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {fmtUsd(t.volume)}
                    </td>
                    <td
                      className={`px-4 py-3 tabular-nums ${
                        (chg ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {fmtPct(chg)}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {t.smart_degen_count ?? 0}/{t.renowned_count ?? 0}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {t.twitter_status === "dead" || t.skip_research ? (
                        <span
                          className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-600"
                          title={t.twitter_raw || "无效/已注销"}
                        >
                          已注销
                        </span>
                      ) : t.twitter_username ? (
                        <span className="text-sky-600">
                          @{t.twitter_username}
                        </span>
                      ) : (
                        <span className="text-zinc-300">无 X</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/token/${t.chain}/${t.address}`}
                        onClick={() => openToken(t)}
                        className="inline-flex rounded-lg bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-800"
                      >
                        分析
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {!loading && tokens.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-16 text-center text-zinc-400"
                  >
                    {error
                      ? "加载失败"
                      : "该条件下暂无新币，可放宽「币龄」或点强制刷新"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-center text-[11px] text-[var(--text-muted)]">
          币龄过滤走 GMGN max-created · 缓存 {Math.round(HOT_CACHE_TTL_MS / 60000)}{" "}
          分钟 · 仅供研究教育
          {tokens[0] ? ` · ${shortAddr(tokens[0].address)}` : ""}
        </p>
      </div>
    </div>
  );
}
