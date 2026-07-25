"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getToken,
  looksLikeContractAddress,
  saveFocusToken,
} from "@/lib/api";
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
import { useI18n } from "@/lib/i18n/I18nProvider";

const AGE_OPTION_IDS = ["24h", "3d", "7d", "14d", "30d", "all"] as const;

export default function DashboardPage() {
  const router = useRouter();
  const { t: tr } = useI18n();
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
    AGE_OPTION_IDS.includes(prefs.maxCreated as (typeof AGE_OPTION_IDS)[number])
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
  const [customToken, setCustomToken] = useState<Token | null>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

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
        "market",
        `拉取热门 · interval=${interval} · age=${maxCreated} · limit=${limit}`,
        "run"
      );
      agentLog(
        "market",
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
          agentLog("market", `命中本地缓存 · ${total} tokens`, "ok");
        } else {
          agentLog("market", `行情返回 · ${total} tokens`, "ok");
        }
        for (const c of ALL_CHAIN_IDS) {
          const n = payload.byChain[c]?.length ?? 0;
          const err = payload.chainErrors?.[c];
          if (err) agentLog(c, `失败: ${err}`, "err");
          else agentLog(c, `${n} 条`, n ? "ok" : "warn");
        }
        if (errChains.length) {
          agentLog("market", `部分链失败: ${errChains.join(", ")}`, "warn");
        }

        if (rv && !force) {
          agentLog("market", "后台静默刷新中…", "run");
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
              agentLog("market", `后台刷新完成 · ${n2} tokens`, "ok");
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
        agentLog("market", `抓取失败: ${msg}`, "err");
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
    // CA lookup is handled separately — still filter board if partial match
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

  /** Resolve pasted CA and surface as custom row. */
  const lookupCustom = useCallback(
    async (raw?: string, goAnalyze = false) => {
      const addr = (raw ?? q).trim();
      if (!looksLikeContractAddress(addr)) {
        setCustomToken(null);
        setCustomError(null);
        return;
      }
      setCustomLoading(true);
      setCustomError(null);
      const sid = startAgentSession("查询自定义代币", 1);
      agentLog("market", `token info · ${chain} · ${addr.slice(0, 8)}…`, "run");
      try {
        const res = await getToken({
          chain,
          address: addr,
          probe: true,
        });
        const t = res.token;
        setCustomToken(t);
        if (res.probed && res.chain !== chain) {
          agentLog(
            "market",
            `在 ${res.chain} 命中（当前 Tab 为 ${chain}）`,
            "warn"
          );
        } else {
          agentLog(
            "market",
            `命中 ${t.symbol || shortAddr(t.address)}`,
            "ok"
          );
        }
        endAgentSession(sid, "done", "自定义代币就绪");
        if (goAnalyze) {
          saveFocusToken(t);
          router.push(`/token/${t.chain}/${t.address}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setCustomToken(null);
        setCustomError(msg);
        agentLog("market", `查询失败: ${msg}`, "err");
        endAgentSession(sid, "error", "自定义代币查询失败");
      } finally {
        setCustomLoading(false);
      }
    },
    [q, chain, router]
  );

  // Debounced CA lookup when search looks like an address
  useEffect(() => {
    const addr = q.trim();
    if (!looksLikeContractAddress(addr)) {
      setCustomToken(null);
      setCustomError(null);
      return;
    }
    const t = window.setTimeout(() => {
      void lookupCustom(addr, false);
    }, 450);
    return () => window.clearTimeout(t);
  }, [q, chain, lookupCustom]);

  const hasData = Object.values(byChain).some((t) => t.length > 0);
  const ageLabel = tr(`board.age.${maxCreated}` as "board.age.7d") || maxCreated;

  const cacheLabelI18n = useMemo(() => {
    if (!fetchedAt) return null;
    const age = formatCacheAge(fetchedAt);
    const fresh = isHotCacheFresh(fetchedAt, HOT_CACHE_TTL_MS);
    if (revalidating) return tr("board.revalidating", { age });
    if (fromCache && fresh) return tr("board.cacheFresh", { age });
    if (fromCache && !fresh) return tr("board.cacheStale", { age });
    return tr("board.updated", { age });
  }, [fetchedAt, fromCache, revalidating, tr]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-white px-5">
        <div>
          <h1 className="text-sm font-semibold">{tr("board.title")}</h1>
          <p className="text-xs text-[var(--text-muted)]">
            {tr("board.subtitle", { age: ageLabel })}
            {cacheLabelI18n && (
              <span className="ml-2 text-emerald-700">· {cacheLabelI18n}</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading || revalidating}
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {loading || revalidating ? tr("board.refreshing") : tr("board.refresh")}
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
            {AGE_OPTION_IDS.map((id) => (
              <option key={id} value={id}>
                {tr("board.age", { label: tr(`board.age.${id}`) })}
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
                {tr("board.heat", { v })}
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
                {tr("board.perChain", { v })}
              </option>
            ))}
          </select>

          <div className="flex min-w-[200px] flex-1 items-center gap-1.5">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (looksLikeContractAddress(q)) {
                    void lookupCustom(q, true);
                  }
                }
              }}
              placeholder={tr("board.searchPh")}
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] px-3 py-1.5 font-mono text-sm outline-none focus:border-emerald-300"
              spellCheck={false}
            />
            <button
              type="button"
              disabled={customLoading || !q.trim()}
              onClick={() => {
                if (looksLikeContractAddress(q)) {
                  void lookupCustom(q, true);
                }
              }}
              className="shrink-0 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
            >
              {customLoading
                ? tr("board.lookingUp")
                : looksLikeContractAddress(q)
                  ? tr("board.lookupCa")
                  : tr("board.filter")}
            </button>
          </div>
          <label
            className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[11px] text-zinc-600"
          >
            <input
              type="checkbox"
              checked={hideDeadSocial}
              onChange={(e) => setHideDeadSocial(e.target.checked)}
              className="rounded border-zinc-300"
            />
            {tr("board.hideDeadX")}
            {hiddenDeadCount > 0 && (
              <span className="text-zinc-400">({hiddenDeadCount})</span>
            )}
          </label>
        </div>
        <p className="mt-2 text-[11px] text-zinc-400">{tr("board.hint")}</p>
        {chainErrors[chain] && (
          <p className="mt-1 text-xs text-rose-600">{chainErrors[chain]}</p>
        )}
        {error && <p className="mt-1 text-sm text-rose-600">{error}</p>}
        {customError && (
          <p className="mt-1 text-xs text-rose-600">
            {tr("board.customTitle")}: {customError}
          </p>
        )}
      </div>

      <div className="mm-scroll min-h-0 flex-1 overflow-auto p-5">
        {loading && !hasData && (
          <div className="mb-3 text-sm text-zinc-400">{tr("board.loading")}</div>
        )}

        {/* Custom CA result — always above hot table when present */}
        {(customToken || customLoading) && (
          <div className="mb-4 overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/40 shadow-[var(--shadow)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 bg-emerald-50/80 px-4 py-2.5">
              <div>
                <p className="text-[12px] font-semibold text-emerald-900">
                  {tr("board.customTitle")}
                  {customLoading ? tr("board.customLoading") : ""}
                </p>
                <p className="text-[10px] text-emerald-800/70">
                  {tr("board.customHint")}
                </p>
              </div>
              {customToken && (
                <Link
                  href={`/token/${customToken.chain}/${customToken.address}`}
                  onClick={() => openToken(customToken)}
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
                >
                  {tr("board.openAnalyze")}
                </Link>
              )}
            </div>
            {customToken && (
              <div className="flex flex-wrap items-center gap-4 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  {customToken.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={customToken.logo}
                      alt=""
                      className="h-9 w-9 rounded-full bg-white object-cover"
                    />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-zinc-200" />
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold text-zinc-900">
                      {customToken.symbol || "—"}
                      <span className="ml-2 rounded bg-white px-1.5 py-0.5 text-[10px] font-medium uppercase text-zinc-500 ring-1 ring-zinc-200">
                        {customToken.chain}
                      </span>
                    </div>
                    <div className="truncate text-xs text-zinc-500">
                      {customToken.name}
                    </div>
                    <div className="mt-0.5 break-all font-mono text-[10px] text-zinc-400">
                      {customToken.address}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-sm tabular-nums text-zinc-700">
                  <div>
                    <div className="text-[10px] uppercase text-zinc-400">
                      MCap
                    </div>
                    {fmtUsd(customToken.market_cap)}
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-zinc-400">
                      Vol 24h
                    </div>
                    {fmtUsd(customToken.volume)}
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-zinc-400">
                      涨跌
                    </div>
                    <span
                      className={
                        (customToken.price_change_percent ?? 0) >= 0
                          ? "text-emerald-600"
                          : "text-rose-600"
                      }
                    >
                      {fmtPct(customToken.price_change_percent)}
                    </span>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-zinc-400">
                      币龄
                    </div>
                    {fmtAge(customToken.age_hours)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-[var(--shadow)]">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">{tr("board.col.rank")}</th>
                <th className="px-4 py-3 font-medium">{tr("board.col.token")}</th>
                <th className="px-4 py-3 font-medium">{tr("board.col.age")}</th>
                <th className="px-4 py-3 font-medium">{tr("board.col.mcap")}</th>
                <th className="px-4 py-3 font-medium">{tr("board.col.vol")}</th>
                <th className="px-4 py-3 font-medium">{tr("board.col.chg")}</th>
                <th className="px-4 py-3 font-medium">{tr("board.col.sm")}</th>
                <th className="px-4 py-3 font-medium">{tr("board.col.social")}</th>
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
                          {tr("board.deadX")}
                        </span>
                      ) : t.twitter_username ? (
                        <span className="text-sky-600">
                          @{t.twitter_username}
                        </span>
                      ) : (
                        <span className="text-zinc-300">{tr("board.noX")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/token/${t.chain}/${t.address}`}
                        onClick={() => openToken(t)}
                        className="inline-flex rounded-lg bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-800"
                      >
                        {tr("board.analyze")}
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
                      ? tr("board.loadFail")
                      : looksLikeContractAddress(q)
                        ? customLoading
                          ? tr("board.emptyCaLoading")
                          : customToken
                            ? tr("board.emptyCaHit")
                            : customError
                              ? tr("board.emptyCaFail")
                              : tr("board.emptyCa")
                        : tr("board.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-center text-[11px] text-[var(--text-muted)]">
          {tr("board.footer", {
            min: Math.round(HOT_CACHE_TTL_MS / 60000),
          })}
          {tokens[0] ? ` · ${shortAddr(tokens[0].address)}` : ""}
        </p>
      </div>
    </div>
  );
}
