"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  analyzeToken,
  chat,
  generatePlaybook,
  loadFocusToken,
  RequestAbortedError,
  saveFocusToken,
  twitterOps,
  websiteOps,
} from "@/lib/api";
import type { Analysis, Token } from "@/lib/types";
import { fmtAge, fmtPct, fmtUsd, shortAddr } from "@/lib/format";
import { loadLlmPrefs, llmRequestFields, type LlmPrefs } from "@/lib/llmPrefs";
import RichText from "@/components/RichText";
import GuideDimensions from "@/components/GuideDimensions";
import ChatComposer, { type ChatAttachment } from "@/components/ChatComposer";
import {
  agentLog,
  endAgentSession,
  startAgentSession,
  tickAgentProgress,
} from "@/lib/agentLog";
import { useI18n } from "@/lib/i18n/I18nProvider";

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  files?: { name: string }[];
};

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Public chart page — neutral third-party, not our data-vendor brand. */
function publicChartUrl(chain: string, address: string) {
  const c = (chain || "sol").toLowerCase();
  const path =
    c === "sol" || c === "robinhood"
      ? "solana"
      : c === "eth"
        ? "ethereum"
        : c === "bsc"
          ? "bsc"
          : c === "base"
            ? "base"
            : "solana";
  return `https://dexscreener.com/${path}/${address}`;
}

export default function TokenWorkspacePage() {
  return (
    <Suspense fallback={<WorkspaceSuspenseFallback />}>
      <WorkspaceInner />
    </Suspense>
  );
}

function WorkspaceSuspenseFallback() {
  const { t } = useI18n();
  return (
    <div className="flex h-full items-center justify-center text-zinc-400">
      {t("ws.loading")}
    </div>
  );
}

function WorkspaceInner() {
  const { t, locale } = useI18n();
  const params = useParams<{ chain: string; address: string }>();
  const chain = params.chain;
  const address = params.address;
  const [token, setToken] = useState<Token | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [opsText, setOpsText] = useState("");
  const [opsMeta, setOpsMeta] = useState("");
  const [webText, setWebText] = useState("");
  const [webMeta, setWebMeta] = useState("");
  const [loadingN, setLoadingN] = useState(false);
  const [loadingO, setLoadingO] = useState(false);
  const [loadingW, setLoadingW] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMoreMarket, setShowMoreMarket] = useState(false);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [playbookBusy, setPlaybookBusy] = useState(false);
  // Empty first — hydrate from localStorage after mount (SSR-safe)
  const [llm, setLlm] = useState<LlmPrefs>({});
  const chatEnd = useRef<HTMLDivElement>(null);
  const seeded = useRef<string | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setLlm(loadLlmPrefs());
  }, []);

  useEffect(() => {
    const cached = loadFocusToken();
    if (cached && cached.chain === chain && cached.address === address) {
      setToken(cached);
    } else {
      setToken({
        chain,
        address,
        symbol: shortAddr(address),
        name: shortAddr(address),
      });
    }
  }, [chain, address]);

  // short welcome — re-seed when token or language changes
  useEffect(() => {
    if (!token) return;
    const key = `${token.chain}:${token.address}:${locale}`;
    if (seeded.current === key) return;
    const prevKey = seeded.current;
    seeded.current = key;
    const welcome = t("ws.welcome", { symbol: token.symbol });
    // only hard-reset chat when token changes; language toggle refreshes first assistant msg
    if (!prevKey || !prevKey.startsWith(`${token.chain}:${token.address}:`)) {
      setMessages([
        {
          id: uid(),
          role: "assistant",
          content: welcome,
        },
      ]);
      return;
    }
    setMessages((prev) => {
      if (prev.length === 0) {
        return [{ id: uid(), role: "assistant", content: welcome }];
      }
      if (prev[0].role === "assistant") {
        return [{ ...prev[0], content: welcome }, ...prev.slice(1)];
      }
      return [{ id: uid(), role: "assistant", content: welcome }, ...prev];
    });
  }, [token?.chain, token?.address, token?.symbol, locale, t]);

  // one brief when analysis ready (no extra widgets)
  useEffect(() => {
    if (!token || !analysis) return;
    const id = `brief_${token.address}`;
    const content = buildBriefText(token, analysis, t);
    setMessages((prev) => {
      if (prev.some((m) => m.id === id)) {
        return prev.map((m) => (m.id === id ? { ...m, content } : m));
      }
      return [...prev, { id, role: "assistant" as const, content }];
    });
  }, [analysis, token, t, locale]);

  const runNarrative = useCallback(
    async (t: Token) => {
      const en = locale === "en";
      setLoadingN(true);
      setError(null);
      agentLog(
        "token",
        en
          ? `Load ${t.symbol} metadata (${t.chain})`
          : `读取 ${t.symbol} 基础元数据 (${t.chain})`,
        "run"
      );
      agentLog(
        "llm",
        en ? `Summarizing ${t.symbol}…` : `摘要分析 ${t.symbol}…`,
        "run"
      );
      try {
        const res = await analyzeToken(t, llmRequestFields(llm, locale));
        setAnalysis(res.analysis);
        saveFocusToken(t);
        const one = res.analysis?.one_liner?.slice(0, 48);
        agentLog(
          "llm",
          one
            ? en
              ? `Summary done · ${one}`
              : `摘要完成 · ${one}`
            : en
              ? "Summary done"
              : "摘要完成",
          "ok"
        );
        tickAgentProgress(
          en ? `Summary · ${t.symbol}` : `摘要完成 · ${t.symbol}`
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        agentLog(
          "llm",
          en ? `Summary failed: ${msg}` : `摘要失败: ${msg}`,
          "err"
        );
        setError(msg);
        tickAgentProgress(
          en ? `Summary failed · ${t.symbol}` : `摘要失败 · ${t.symbol}`
        );
      } finally {
        setLoadingN(false);
      }
    },
    [llm, locale]
  );

  const runOps = useCallback(
    async (t: Token) => {
      const en = locale === "en";
      if (t.twitter_status === "dead" || t.skip_research) {
        setOpsText(
          en
            ? "X account invalid — skipped tweet analysis."
            : "X 已失效，跳过推文分析。"
        );
        setOpsMeta("");
        agentLog("twitter", en ? "X invalid, skip" : "X 已失效，跳过", "warn");
        tickAgentProgress(en ? "Twitter skipped" : "推特已跳过");
        return;
      }
      if (!t.twitter_username) {
        setOpsText(
          en
            ? "No valid X handle — skipped tweet analysis."
            : "无有效 X，跳过推文分析。"
        );
        setOpsMeta("");
        agentLog(
          "twitter",
          en ? "no twitter_username, skip" : "无 twitter_username，跳过",
          "warn"
        );
        tickAgentProgress(en ? "Twitter skipped" : "推特已跳过");
        return;
      }
      setLoadingO(true);
      agentLog(
        "social",
        en
          ? `Fetching @${t.twitter_username} tweets…`
          : `抓取 @${t.twitter_username} 推文…`,
        "run"
      );
      try {
        const res = await twitterOps({
          token: t,
          username: t.twitter_username,
          question: en
            ? `Teardown @${t.twitter_username} (${t.symbol}) launch path: first post hook, concept intro, project push, visual system. Full answer in English.`
            : `拆解 @${t.twitter_username}（${t.symbol}）的立项路径：第一条推文怎么切入、概念怎么介绍、项目怎么推进、配图视觉系统怎么做。`,
          ...llmRequestFields(llm, locale),
        });
        // Soft API always returns content; never surface HTTP status text
        const body =
          (res.content && String(res.content).trim()) ||
          (en
            ? "No tweet analysis available. Try Re-run."
            : "暂无推文分析，请点重新分析。");
        setOpsText(body);
        // Product meta only — no model / fetch diagnostics
        setOpsMeta(
          [
            res.username ? `@${res.username}` : "",
            res.tweet_count != null
              ? en
                ? `${res.tweet_count} posts`
                : `${res.tweet_count} 条`
              : "",
          ]
            .filter(Boolean)
            .join(" · ")
        );
        if (res.ok === false || !(res.tweet_count && res.tweet_count > 0)) {
          agentLog(
            "twitter",
            en
              ? `No tweets fetched · ${res.tweet_count ?? 0}`
              : `未抓到推文，已停止分析（不编造）· ${res.tweet_count ?? 0} 条`,
            "err"
          );
          tickAgentProgress(en ? "Twitter empty" : "推特无数据");
        } else {
          agentLog(
            "twitter",
            en
              ? `Launch path done · ${res.tweet_count} posts`
              : `立项路径拆解完成 · ${res.tweet_count} 条`,
            "ok"
          );
          agentLog(
            "llm",
            en ? "Twitter ops written to middle column" : "推特运营路径写入中间列",
            "ok"
          );
          tickAgentProgress(
            en
              ? `Twitter done · ${res.tweet_count}`
              : `推特完成 · ${res.tweet_count} 条`
          );
        }
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        const friendly =
          raw === "SERVICE_TEMP_UNAVAILABLE" ||
          /internal server error/i.test(raw)
            ? en
              ? "Tweet analysis is temporarily unavailable. Please try **Re-run** in a moment."
              : "推文分析暂时不可用，请稍后点 **重新分析**。"
            : en
              ? `Could not complete tweet analysis. Please try Re-run.`
              : `推文分析未完成，请点重新分析再试。`;
        agentLog(
          "twitter",
          en ? "Tweet analysis failed (soft)" : "推文分析失败（已降级）",
          "err"
        );
        setOpsText(friendly);
        tickAgentProgress(en ? "Twitter failed" : "推特失败");
      } finally {
        setLoadingO(false);
      }
    },
    [llm, locale]
  );

  const runWebsite = useCallback(
    async (t: Token) => {
      const en = locale === "en";
      if (!t.website) {
        setWebText("");
        setWebMeta("");
        agentLog("web", en ? "No website, skip" : "未绑定官网，跳过", "info");
        tickAgentProgress(en ? "Website skipped" : "网站已跳过");
        return;
      }
      setLoadingW(true);
      const host = t.website.replace(/^https?:\/\//, "");
      agentLog(
        "web",
        en ? `Open site ${host}…` : `打开官网 ${host}…`,
        "run"
      );
      try {
        const res = await websiteOps({
          token: t,
          url: t.website,
          ...llmRequestFields(llm, locale),
        });
        setWebText(res.content || (en ? "No result" : "无结果"));
        // URL only in meta — stack/model are for the analysis body, not chrome
        setWebMeta(res.final_url || res.url || t.website || "");
        if (res.ok === false) {
          agentLog(
            "web",
            en ? "Website fetch failed" : "网站抓取失败或无法解析",
            "err"
          );
          tickAgentProgress(en ? "Website failed" : "网站失败");
        } else {
          agentLog(
            "web",
            tech
              ? en
                ? `Landing teardown done · ${tech}`
                : `落地页拆解完成 · ${tech}`
              : en
                ? "Landing teardown done"
                : "落地页拆解完成",
            "ok"
          );
          tickAgentProgress(en ? "Website done" : "网站完成");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        agentLog(
          "web",
          en ? `Website analysis failed: ${msg}` : `网站分析失败: ${msg}`,
          "err"
        );
        setWebText(
          en ? `Website analysis failed: ${msg}` : `网站分析失败：${msg}`
        );
        tickAgentProgress(en ? "Website failed" : "网站失败");
      } finally {
        setLoadingW(false);
      }
    },
    [llm, locale]
  );

  useEffect(() => {
    if (!token) return;
    // 3 steps: 摘要 / 推特 / 网站 — top bar progress without auto-opening drawer
    const sid = startAgentSession(
      locale === "en"
        ? `Workspace · ${token.symbol}`
        : `分析工作台 · ${token.symbol}`,
      3
    );
    agentLog(
      "system",
      locale === "en"
        ? `Open ${token.chain}/${shortAddr(token.address)}`
        : `进入 ${token.chain}/${shortAddr(token.address)}`,
      "info"
    );
    void (async () => {
      // Sequential: avoid 3 concurrent LLM+IO spikes that OOM small Railway dynos
      // and surface as bare "Internal Server Error" on Twitter ops.
      await runOps(token);
      await runNarrative(token);
      await runWebsite(token);
      endAgentSession(
        sid,
        "done",
        locale === "en"
          ? `${token.symbol} columns ready`
          : `${token.symbol} 三列数据就绪`
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token?.address, locale]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatBusy]);

  const stopChat = () => {
    chatAbortRef.current?.abort();
  };

  const runPlaybook = async () => {
    if (!token || playbookBusy || chatBusy) return;
    chatAbortRef.current?.abort();
    const ac = new AbortController();
    chatAbortRef.current = ac;
    setPlaybookBusy(true);
    setChatBusy(true);
    const sid = startAgentSession(
      locale === "en"
        ? `Ops playbook · ${token.symbol}`
        : `生成运营思路 · ${token.symbol}`,
      1
    );
    agentLog(
      "llm",
      locale === "en"
        ? "Merging board + Twitter/website…"
        : "汇总左列盘面 + 中列推特/网站…",
      "run"
    );
    setMessages((m) => [
      ...m,
      {
        id: uid(),
        role: "user",
        content:
          locale === "en"
            ? `Using ${token.symbol} board + Twitter/website teardown, write my own ops playbook (English).`
            : `基于 ${token.symbol} 的盘面 + 推特/网站拆解，生成我自己的运营思路`,
      },
    ]);
    try {
      const res = await generatePlaybook({
        token,
        analysis,
        twitter_ops: opsText,
        website_ops: webText,
        ...llmRequestFields(llm, locale),
        signal: ac.signal,
      });
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "assistant",
          content: res.content || (locale === "en" ? "(empty)" : "（空）"),
        },
      ]);
      agentLog(
        "llm",
        locale === "en" ? "Playbook written to chat" : "运营思路已写入右侧对话",
        "ok"
      );
      endAgentSession(sid, "done");
    } catch (e) {
      if (e instanceof RequestAbortedError || ac.signal.aborted) {
        agentLog(
          "llm",
          locale === "en" ? "Stopped by user" : "用户停止生成",
          "warn"
        );
        endAgentSession(
          sid,
          "error",
          locale === "en" ? "Stopped" : "已停止生成"
        );
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "assistant",
            content: locale === "en" ? "Generation stopped." : "已停止生成。",
          },
        ]);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        agentLog(
          "llm",
          locale === "en"
            ? `Playbook failed: ${msg}`
            : `运营思路失败: ${msg}`,
          "err"
        );
        endAgentSession(sid, "error");
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "assistant",
            content:
              locale === "en"
                ? `Playbook failed: ${msg}`
                : `手册失败：${msg}`,
          },
        ]);
      }
    } finally {
      if (chatAbortRef.current === ac) chatAbortRef.current = null;
      setPlaybookBusy(false);
      setChatBusy(false);
    }
  };

  const sendChat = async (
    textRaw?: string,
    attachments: ChatAttachment[] = []
  ) => {
    const text = (textRaw ?? input).trim();
    if ((!text && attachments.length === 0) || !token || chatBusy) return;
    chatAbortRef.current?.abort();
    const ac = new AbortController();
    chatAbortRef.current = ac;
    setInput("");
    setChatBusy(true);

    const attachNote = attachments
      .map((a) => {
        if (a.text) return `【附件 ${a.name}】\n${a.text.slice(0, 12000)}`;
        if (a.previewUrl) return `【图片 ${a.name}】`;
        return `【附件 ${a.name}】`;
      })
      .join("\n\n");

    const display =
      text +
      (attachments.length
        ? `\n\n📎 ${attachments.map((a) => a.name).join("、")}`
        : "");
    const messageForLlm = [text, attachNote].filter(Boolean).join("\n\n");

    const userMsg: ChatMsg = {
      id: uid(),
      role: "user",
      content: display,
      files: attachments.map((a) => ({ name: a.name })),
    };
    setMessages((m) => [...m, userMsg]);
    const sid = startAgentSession(
      locale === "en" ? "Chat reply" : "对话回复",
      1
    );
    agentLog(
      "chat",
      locale === "en"
        ? `User · ${text.slice(0, 40) || "attachment"}…`
        : `用户提问 · ${text.slice(0, 40) || "附件"}…`,
      "run"
    );
    try {
      const history = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await chat({
        message: messageForLlm,
        history: history.slice(0, -1),
        ...llmRequestFields(llm, locale),
        signal: ac.signal,
        context: {
          mode: "ops_review",
          lang: locale,
          instruction:
            locale === "en"
              ? "Using left board + middle Twitter launch path + website teardown, help the user recap into their own ops plan. Learn structure, not skin. English Markdown. Not investment advice."
              : "基于左侧盘面 + 中间推特立项路径 + 网站拆解，帮用户复盘并沉淀自己的运营思路。学结构不抄皮。Markdown。非投资建议。",
          benchmark_token: {
            chain: token.chain,
            address: token.address,
            symbol: token.symbol,
            name: token.name,
            market_cap: token.market_cap,
            volume: token.volume,
            age_hours: token.age_hours,
            twitter_username: token.twitter_username,
            website: token.website,
          },
          token_snapshot: analysis,
          twitter_ops_excerpt: opsText.slice(0, 2500),
          website_ops_excerpt: webText.slice(0, 2000),
        },
      });
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "assistant",
          content: res.content || (locale === "en" ? "(empty)" : "（空）"),
        },
      ]);
      agentLog("chat", locale === "en" ? "Reply done" : "回复完成", "ok");
      endAgentSession(
        sid,
        "done",
        locale === "en" ? "Reply done" : "回复完成"
      );
    } catch (e) {
      if (e instanceof RequestAbortedError || ac.signal.aborted) {
        agentLog(
          "chat",
          locale === "en" ? "Stopped by user" : "用户停止生成",
          "warn"
        );
        endAgentSession(
          sid,
          "error",
          locale === "en" ? "Stopped" : "已停止生成"
        );
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "assistant",
            content: locale === "en" ? "Generation stopped." : "已停止生成。",
          },
        ]);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        agentLog(
          "chat",
          locale === "en" ? `Chat failed: ${msg}` : `对话失败: ${msg}`,
          "err"
        );
        endAgentSession(
          sid,
          "error",
          locale === "en" ? "Chat failed" : "对话失败"
        );
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "assistant",
            content:
              locale === "en" ? `Failed: ${msg}` : `失败：${msg}`,
          },
        ]);
      }
    } finally {
      if (chatAbortRef.current === ac) chatAbortRef.current = null;
      setChatBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-400">
        {t("ws.loadingShort")}
      </div>
    );
  }

  const deadSocial =
    token.twitter_status === "dead" || token.skip_research;
  const hasTwitter = !!(token.twitter_username && !deadSocial);
  const hasWebsite = !!token.website;
  const langNote =
    locale === "en"
      ? "Reply in English. Research only. Learn structure, do not copy skin."
      : "用中文回复。研究教育。学结构不抄皮。";

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-50">
      {/* top */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-3">
        <Link
          href="/"
          className="shrink-0 text-[11px] text-zinc-400 hover:text-zinc-700"
        >
          {t("ws.back")}
        </Link>
        <span className="text-zinc-300">/</span>
        {token.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={token.logo}
            alt=""
            className="h-6 w-6 rounded-md object-cover ring-1 ring-black/5"
          />
        ) : (
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100 text-[10px] font-bold text-zinc-500">
            {(token.symbol || "?").slice(0, 2)}
          </div>
        )}
        <div className="min-w-0 flex-1 truncate text-[13px]">
          <span className="font-semibold text-zinc-900">{token.symbol}</span>
          <span className="ml-1.5 text-zinc-400">{token.name}</span>
          <span className="ml-2 text-[11px] text-zinc-400">
            {token.chain} · {fmtAge(token.age_hours)} · {fmtUsd(token.market_cap)}
            <span
              className={
                (token.price_change_percent ?? 0) >= 0
                  ? " text-emerald-600"
                  : " text-rose-600"
              }
            >
              {" "}
              {fmtPct(token.price_change_percent)}
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            void runNarrative(token);
            void runOps(token);
            void runWebsite(token);
          }}
          disabled={loadingN || loadingO || loadingW}
          className="shrink-0 rounded-md bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {loadingN || loadingO || loadingW
            ? t("ws.refreshing")
            : t("ws.refresh")}
        </button>
      </header>

      {error && (
        <div className="shrink-0 border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-zinc-200 lg:grid-cols-12 lg:divide-x lg:divide-y-0">
        {/* ═══ LEFT thin ═══ */}
        <aside className="mm-scroll flex min-h-0 flex-col overflow-auto bg-white lg:col-span-3">
          <div className="space-y-3 p-3">
            {deadSocial && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-800">
                {t("ws.deadX")}
              </div>
            )}

            {/* key metrics only */}
            <div className="grid grid-cols-2 gap-1.5">
              <Mini label={t("ws.mcap")} value={fmtUsd(token.market_cap)} />
              <Mini label={t("ws.vol")} value={fmtUsd(token.volume)} />
              <Mini label={t("ws.age")} value={fmtAge(token.age_hours)} />
              <Mini
                label="24h"
                value={fmtPct(token.price_change_percent)}
                up={(token.price_change_percent ?? 0) >= 0}
              />
            </div>

            <button
              type="button"
              onClick={() => setShowMoreMarket((v) => !v)}
              className="text-[11px] text-zinc-400 hover:text-zinc-600"
            >
              {showMoreMarket ? t("ws.lessMarket") : t("ws.moreMarket")}
            </button>
            {showMoreMarket && (
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <Mini label={t("ws.liquidity")} value={fmtUsd(token.liquidity)} />
                <Mini
                  label={t("ws.holders")}
                  value={String(token.holder_count ?? "—")}
                />
                <Mini
                  label={t("ws.top10")}
                  value={
                    token.top_10_holder_rate != null
                      ? `${(token.top_10_holder_rate * 100).toFixed(0)}%`
                      : "—"
                  }
                />
                <Mini
                  label={t("ws.rug")}
                  value={
                    token.rug_ratio != null
                      ? token.rug_ratio.toFixed(2)
                      : "—"
                  }
                />
                <Mini
                  label={t("ws.smKol")}
                  value={`${token.smart_degen_count ?? 0}/${token.renowned_count ?? 0}`}
                />
                {token.launchpad_platform && (
                  <Mini label={t("ws.platform")} value={token.launchpad_platform} />
                )}
              </div>
            )}

            {/* identity snapshot — flat, line-separated */}
            <div className="border border-zinc-200 p-3">
              <p className="text-[10px] font-semibold text-zinc-400">
                {t("ws.whatIsThis")}
              </p>
              {loadingN && !analysis ? (
                <p className="mt-1.5 text-xs text-zinc-400">{t("ws.summaryLoading")}</p>
              ) : (
                <>
                  <p className="mt-1.5 text-[13px] font-medium leading-snug text-zinc-900">
                    {analysis?.one_liner || t("ws.noSummary")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(analysis?.track || analysis?.narrative_type) && (
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-zinc-600 ring-1 ring-zinc-100">
                        {analysis?.track || analysis?.narrative_type}
                      </span>
                    )}
                    {token.launchpad_platform && (
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-zinc-600 ring-1 ring-zinc-100">
                        {token.launchpad_platform}
                      </span>
                    )}
                  </div>
                  {analysis?.emotional_hook && (
                    <p className="mt-2 text-[11px] leading-snug text-zinc-600">
                      {t("ws.hook", { text: analysis.emotional_hook })}
                    </p>
                  )}
                  {!!analysis?.risks?.length && (
                    <p className="mt-2 text-[11px] text-amber-800">
                      {t("ws.note", { text: analysis.risks[0] })}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* links */}
            <div className="flex flex-col gap-1.5 text-[12px]">
              {token.twitter_username && !deadSocial && (
                <a
                  href={`https://x.com/${token.twitter_username}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-600 hover:underline"
                >
                  @{token.twitter_username}
                </a>
              )}
              {token.website && (
                <a
                  href={token.website}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-zinc-600 hover:underline"
                >
                  {token.website.replace(/^https?:\/\//, "")}
                </a>
              )}
              <a
                href={publicChartUrl(token.chain, token.address)}
                target="_blank"
                rel="noreferrer"
                className="text-zinc-500 hover:underline"
              >
                {t("ws.openChart")}
              </a>
            </div>
          </div>
        </aside>

        {/* ═══ MIDDLE: 推特 / 网站 — two separate scroll blocks ═══ */}
        <section className="mm-scroll min-h-0 overflow-y-auto overflow-x-hidden bg-white lg:col-span-5">
          <GuideDimensions
            opsText={opsText}
            opsMeta={opsMeta}
            loadingOps={loadingO}
            onRefreshOps={() => void runOps(token)}
            websiteText={webText}
            websiteMeta={webMeta}
            loadingWebsite={loadingW}
            onRefreshWebsite={() => void runWebsite(token)}
            hasTwitter={hasTwitter}
            hasWebsite={hasWebsite}
          />
        </section>

        {/* ═══ RIGHT chat: recap → own ops plan ═══ */}
        <aside className="flex min-h-0 flex-col bg-white lg:col-span-4">
          <div className="flex h-10 shrink-0 items-center border-b border-zinc-100 px-3">
            <h2 className="text-[12px] font-semibold text-zinc-800">
              {t("ws.recapTitle", { symbol: token.symbol })}
            </h2>
          </div>

          <div className="mm-scroll mm-chat-scroll min-h-0 flex-1 space-y-4 overflow-auto px-3 py-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {m.role === "assistant" ? (
                  /* long SOP / handbook: document-style, not a cramped bubble */
                  <div className="mm-chat-assistant w-full min-w-0 border border-zinc-200 bg-white px-4 py-4 sm:px-5 sm:py-5">
                    <RichText text={m.content} spacious />
                    {!!m.files?.length && (
                      <div className="mt-3 border-t border-zinc-100 pt-2 text-[11px] text-zinc-400">
                        {m.files.map((f) => f.name).join("、")}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mm-chat-user max-w-[92%] border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-[13px] leading-[1.65] text-zinc-50">
                    <span className="whitespace-pre-wrap break-words">
                      {m.content}
                    </span>
                    {!!m.files?.length && (
                      <div className="mt-2 border-t border-white/10 pt-1.5 text-[11px] text-zinc-400">
                        {m.files.map((f) => f.name).join("、")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {chatBusy && (
              <p className="py-2 text-center text-[11px] tracking-wide text-zinc-400">
                {t("ws.thinking")}
              </p>
            )}
            <div ref={chatEnd} />
          </div>

          <ChatComposer
            value={input}
            onChange={setInput}
            busy={chatBusy}
            onStop={stopChat}
            placeholder={t("ws.chatPh")}
            primaryAction={{
              label: playbookBusy ? t("ws.playbookBusy") : t("ws.playbook"),
              onClick: () => void runPlaybook(),
              busy: playbookBusy,
            }}
            chips={[
              {
                label: t("ws.chip.extend"),
                prompt: [
                  locale === "en"
                    ? `Using $${token.symbol} as a case study (learn structure, do not copy), propose 3–5 similar/extension product directions.`
                    : `以对标 $${token.symbol} 为案例（学结构不抄皮），给出 3–5 个**同类/延伸产品**方向。`,
                  locale === "en"
                    ? "Each: portable structure · must-change skin · one-liner · difference · risks. Markdown."
                    : "每个方向：可学结构、必须换的皮、一句话立项、与原盘差异、风险。Markdown 分节。",
                  langNote,
                ].join("\n"),
              },
              {
                label: t("ws.chip.structure"),
                prompt: [
                  locale === "en"
                    ? `Extract portable structure from $${token.symbol} (narrative/identity/visual/cadence), checklist + red lines + 3 differentiators.`
                    : `拆 $${token.symbol} 的可迁移结构（叙事/身份/视觉/节奏），列 checklist；红线 + 最小差异化 3 刀。`,
                  langNote,
                ].join("\n"),
              },
              {
                label: t("ws.chip.sop"),
                prompt: [
                  locale === "en"
                    ? `Based on $${token.symbol} board + Twitter/site ops, write an ops SOP for MY reskinned project. Day sections not wide tables.`
                    : `基于对标 ${token.symbol} 的盘面 + 中间推特/网站拆解，生成**我自己的盘**运营 SOP。日历用 Day 小节，勿宽表格。`,
                  langNote,
                ].join("\n"),
              },
            ]}
            onChip={(prompt) => {
              void sendChat(prompt);
            }}
            llm={llm}
            onLlmChange={setLlm}
            onSend={({ text, attachments }) => {
              void sendChat(text, attachments);
            }}
          />
        </aside>
      </div>
    </div>
  );
}

function buildBriefText(
  token: Token,
  analysis: Analysis,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const lines = [
    t("ws.briefReady", { symbol: token.symbol }),
    analysis.one_liner
      ? t("ws.briefOneLiner", { line: analysis.one_liner })
      : "",
    "",
    t("ws.briefHint"),
  ];
  return lines.filter(Boolean).join("\n");
}

function Mini({
  label,
  value,
  up,
}: {
  label: string;
  value: string;
  up?: boolean;
}) {
  return (
    <div className="border border-zinc-200 bg-white px-2 py-1.5">
      <div className="text-[9px] text-zinc-400">{label}</div>
      <div
        className={`text-[12px] font-semibold tabular-nums ${
          up === true
            ? "text-emerald-600"
            : up === false
              ? "text-rose-600"
              : "text-zinc-800"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

