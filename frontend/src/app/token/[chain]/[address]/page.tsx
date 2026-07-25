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

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  files?: { name: string }[];
};

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function gmgnUrl(chain: string, address: string) {
  return `https://gmgn.ai/${chain}/token/${address}`;
}

export default function TokenWorkspacePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-zinc-400">
          加载工作台…
        </div>
      }
    >
      <WorkspaceInner />
    </Suspense>
  );
}

function WorkspaceInner() {
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

  // short welcome only
  useEffect(() => {
    if (!token) return;
    const key = `${token.chain}:${token.address}`;
    if (seeded.current === key) return;
    seeded.current = key;
    setMessages([
      {
        id: uid(),
        role: "assistant",
        content:
          `正在对标 **${token.symbol}**。\n\n` +
          `左侧看盘面，中间拆 **推特立项路径** 和 **网站运营**，右侧跟我复盘。\n\n` +
          `输入框上方可点 **运营思路** 生成你自己的方案；也可直接提问。学结构、换皮相，不做假官方。`,
      },
    ]);
  }, [token?.chain, token?.address, token?.symbol]);

  // one brief when analysis ready (no extra widgets)
  useEffect(() => {
    if (!token || !analysis) return;
    const id = `brief_${token.address}`;
    const content = buildBriefText(token, analysis);
    setMessages((prev) => {
      if (prev.some((m) => m.id === id)) {
        return prev.map((m) => (m.id === id ? { ...m, content } : m));
      }
      return [...prev, { id, role: "assistant" as const, content }];
    });
  }, [analysis, token]);

  const runNarrative = useCallback(
    async (t: Token) => {
      setLoadingN(true);
      setError(null);
      agentLog("token", `读取 ${t.symbol} 基础元数据 (${t.chain})`, "run");
      agentLog("llm", `摘要分析 ${t.symbol}…`, "run");
      try {
        const res = await analyzeToken(t, llmRequestFields(llm));
        setAnalysis(res.analysis);
        saveFocusToken(t);
        agentLog(
          "llm",
          res.analysis?.one_liner
            ? `摘要完成 · ${res.analysis.one_liner.slice(0, 48)}`
            : "摘要完成",
          "ok"
        );
        tickAgentProgress(`摘要完成 · ${t.symbol}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        agentLog("llm", `摘要失败: ${msg}`, "err");
        setError(msg);
        tickAgentProgress(`摘要失败 · ${t.symbol}`);
      } finally {
        setLoadingN(false);
      }
    },
    [llm]
  );

  const runOps = useCallback(
    async (t: Token) => {
      if (t.twitter_status === "dead" || t.skip_research) {
        setOpsText("X 已失效，跳过推文分析。");
        setOpsMeta("");
        agentLog("twitter", "X 已失效，跳过", "warn");
        tickAgentProgress("推特已跳过");
        return;
      }
      if (!t.twitter_username) {
        setOpsText("无有效 X，跳过推文分析。");
        setOpsMeta("");
        agentLog("twitter", "无 twitter_username，跳过", "warn");
        tickAgentProgress("推特已跳过");
        return;
      }
      setLoadingO(true);
      agentLog("twitter", `6551 抓取 @${t.twitter_username} 推文…`, "run");
      try {
        const res = await twitterOps({
          token: t,
          username: t.twitter_username,
          question: `拆解 @${t.twitter_username}（${t.symbol}）的立项路径：第一条推文怎么切入、概念怎么介绍、项目怎么推进、配图视觉系统怎么做。`,
          ...llmRequestFields(llm),
        });
        setOpsText(res.content || "无结果");
        setOpsMeta(
          [
            res.username ? `@${res.username}` : "",
            res.tweet_count != null ? `${res.tweet_count} 条` : "",
            res.model,
          ]
            .filter(Boolean)
            .join(" · ")
        );
        if (res.ok === false || !(res.tweet_count && res.tweet_count > 0)) {
          agentLog(
            "twitter",
            `未抓到推文，已停止分析（不编造）· ${res.tweet_count ?? 0} 条`,
            "err"
          );
          tickAgentProgress("推特无数据");
        } else {
          agentLog(
            "twitter",
            `立项路径拆解完成 · ${res.tweet_count} 条`,
            "ok"
          );
          agentLog("llm", "推特运营路径写入中间列", "ok");
          tickAgentProgress(`推特完成 · ${res.tweet_count} 条`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        agentLog("twitter", `抓取/分析失败: ${msg}`, "err");
        setOpsText(`推文分析失败：${msg}`);
        tickAgentProgress("推特失败");
      } finally {
        setLoadingO(false);
      }
    },
    [llm]
  );

  const runWebsite = useCallback(
    async (t: Token) => {
      if (!t.website) {
        setWebText("");
        setWebMeta("");
        agentLog("web", "未绑定官网，跳过", "info");
        tickAgentProgress("网站已跳过");
        return;
      }
      setLoadingW(true);
      agentLog("web", `打开官网 ${t.website.replace(/^https?:\/\//, "")}…`, "run");
      try {
        const res = await websiteOps({
          token: t,
          url: t.website,
          ...llmRequestFields(llm),
        });
        setWebText(res.content || "无结果");
        const tech = res.fetch?.tech_hints?.slice(0, 4).join(", ");
        setWebMeta(
          [
            res.final_url || res.url || t.website,
            tech ? `栈: ${tech}` : "",
            res.model,
          ]
            .filter(Boolean)
            .join(" · ")
        );
        if (res.ok === false) {
          agentLog("web", "网站抓取失败或无法解析", "err");
          tickAgentProgress("网站失败");
        } else {
          agentLog(
            "web",
            tech ? `落地页拆解完成 · ${tech}` : "落地页拆解完成",
            "ok"
          );
          tickAgentProgress("网站完成");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        agentLog("web", `网站分析失败: ${msg}`, "err");
        setWebText(`网站分析失败：${msg}`);
        tickAgentProgress("网站失败");
      } finally {
        setLoadingW(false);
      }
    },
    [llm]
  );

  useEffect(() => {
    if (!token) return;
    // 3 steps: 摘要 / 推特 / 网站 — top bar progress without auto-opening drawer
    const sid = startAgentSession(`分析工作台 · ${token.symbol}`, 3);
    agentLog(
      "system",
      `进入 ${token.chain}/${shortAddr(token.address)}`,
      "info"
    );
    void (async () => {
      await Promise.all([
        runNarrative(token),
        runOps(token),
        runWebsite(token),
      ]);
      endAgentSession(sid, "done", `${token.symbol} 三列数据就绪`);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token?.address]);

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
    const sid = startAgentSession(`生成运营思路 · ${token.symbol}`, 1);
    agentLog("llm", "汇总左列盘面 + 中列推特/网站…", "run");
    setMessages((m) => [
      ...m,
      {
        id: uid(),
        role: "user",
        content: `基于 ${token.symbol} 的盘面 + 推特/网站拆解，生成我自己的运营思路`,
      },
    ]);
    try {
      const res = await generatePlaybook({
        token,
        analysis,
        twitter_ops: opsText,
        website_ops: webText,
        ...llmRequestFields(llm),
        signal: ac.signal,
      });
      setMessages((m) => [
        ...m,
        { id: uid(), role: "assistant", content: res.content || "（空）" },
      ]);
      agentLog("llm", "运营思路已写入右侧对话", "ok");
      endAgentSession(sid, "done");
    } catch (e) {
      if (e instanceof RequestAbortedError || ac.signal.aborted) {
        agentLog("llm", "用户停止生成", "warn");
        endAgentSession(sid, "error", "已停止生成");
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "assistant",
            content: "已停止生成。",
          },
        ]);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        agentLog("llm", `运营思路失败: ${msg}`, "err");
        endAgentSession(sid, "error");
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "assistant",
            content: `手册失败：${msg}`,
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
    const sid = startAgentSession("对话回复", 1);
    agentLog("chat", `用户提问 · ${text.slice(0, 40) || "附件"}…`, "run");
    try {
      const history = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await chat({
        message: messageForLlm,
        history: history.slice(0, -1),
        ...llmRequestFields(llm),
        signal: ac.signal,
        context: {
          mode: "ops_review",
          instruction:
            "基于左侧盘面 + 中间推特立项路径 + 网站拆解，帮用户复盘并沉淀自己的运营思路。学结构不抄皮。Markdown。非投资建议。",
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
        { id: uid(), role: "assistant", content: res.content || "（空）" },
      ]);
      agentLog("chat", "回复完成", "ok");
      endAgentSession(sid, "done", "回复完成");
    } catch (e) {
      if (e instanceof RequestAbortedError || ac.signal.aborted) {
        agentLog("chat", "用户停止生成", "warn");
        endAgentSession(sid, "error", "已停止生成");
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "assistant",
            content: "已停止生成。",
          },
        ]);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        agentLog("chat", `对话失败: ${msg}`, "err");
        endAgentSession(sid, "error", "对话失败");
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "assistant",
            content: `失败：${msg}`,
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
        加载中…
      </div>
    );
  }

  const deadSocial =
    token.twitter_status === "dead" || token.skip_research;
  const hasTwitter = !!(token.twitter_username && !deadSocial);
  const hasWebsite = !!token.website;

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-50">
      {/* top */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-3">
        <Link
          href="/"
          className="shrink-0 text-[11px] text-zinc-400 hover:text-zinc-700"
        >
          看板
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
          {loadingN || loadingO || loadingW ? "分析中" : "刷新"}
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
                X 已失效，无运营可学价值，建议回看板换币。
              </div>
            )}

            {/* key metrics only */}
            <div className="grid grid-cols-2 gap-1.5">
              <Mini label="市值" value={fmtUsd(token.market_cap)} />
              <Mini label="成交" value={fmtUsd(token.volume)} />
              <Mini label="币龄" value={fmtAge(token.age_hours)} />
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
              {showMoreMarket ? "收起盘面" : "更多盘面数据"}
            </button>
            {showMoreMarket && (
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <Mini label="流动性" value={fmtUsd(token.liquidity)} />
                <Mini
                  label="持有人"
                  value={String(token.holder_count ?? "—")}
                />
                <Mini
                  label="Top10"
                  value={
                    token.top_10_holder_rate != null
                      ? `${(token.top_10_holder_rate * 100).toFixed(0)}%`
                      : "—"
                  }
                />
                <Mini
                  label="Rug"
                  value={
                    token.rug_ratio != null
                      ? token.rug_ratio.toFixed(2)
                      : "—"
                  }
                />
                <Mini
                  label="SM/KOL"
                  value={`${token.smart_degen_count ?? 0}/${token.renowned_count ?? 0}`}
                />
                {token.launchpad_platform && (
                  <Mini label="平台" value={token.launchpad_platform} />
                )}
              </div>
            )}

            {/* identity snapshot — flat, line-separated */}
            <div className="border border-zinc-200 p-3">
              <p className="text-[10px] font-semibold text-zinc-400">
                这盘是什么
              </p>
              {loadingN && !analysis ? (
                <p className="mt-1.5 text-xs text-zinc-400">摘要中…</p>
              ) : (
                <>
                  <p className="mt-1.5 text-[13px] font-medium leading-snug text-zinc-900">
                    {analysis?.one_liner || "暂无摘要"}
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
                      钩子：{analysis.emotional_hook}
                    </p>
                  )}
                  {!!analysis?.risks?.length && (
                    <p className="mt-2 text-[11px] text-amber-800">
                      注意：{analysis.risks[0]}
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
                href={gmgnUrl(token.chain, token.address)}
                target="_blank"
                rel="noreferrer"
                className="text-zinc-500 hover:underline"
              >
                在 GMGN 打开
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
              复盘 · {token.symbol}
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
                思考中…
              </p>
            )}
            <div ref={chatEnd} />
          </div>

          <ChatComposer
            value={input}
            onChange={setInput}
            busy={chatBusy}
            onStop={stopChat}
            placeholder="问：他们怎么立项的？我怎么换皮做…"
            primaryAction={{
              label: "运营思路",
              onClick: () => void runPlaybook(),
              busy: playbookBusy,
            }}
            chips={[
              {
                label: "同类延伸选题",
                prompt: [
                  `以对标 $${token.symbol} 为案例（学结构不抄皮），给出 3–5 个**同类/延伸产品**方向。`,
                  "每个方向：可学结构、必须换的皮、一句话立项、与原盘差异、风险。",
                  "Markdown 分节；非投资建议。",
                ].join("\n"),
              },
              {
                label: "可迁移结构",
                prompt: [
                  `拆 $${token.symbol} 的可迁移结构（叙事/身份/视觉/节奏），列 checklist；`,
                  "并写绝对不能抄的红线 + 我做同类盘的最小差异化 3 刀。学结构不抄皮。",
                ].join("\n"),
              },
              {
                label: "运营SOP（换皮版）",
                prompt: [
                  `基于对标 ${token.symbol} 的盘面 + 中间推特/网站拆解，`,
                  "生成**我自己的盘**可用运营 SOP（学结构不抄皮）。",
                  "",
                  "每个 ## 前后空一行；列表一项一行。",
                  "## 0. 适用范围",
                  "## 1. 立项 SOP",
                  "## 2. 推特运营 SOP（日历用 Day 小节，勿宽表格）",
                  "## 3. 网站 SOP",
                  "## 4. 发射后 48h 清单 `- [ ]`",
                  "## 5. 红线",
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

function buildBriefText(token: Token, analysis: Analysis): string {
  const lines = [
    `**${token.symbol}** 基础信息好了。`,
    analysis.one_liner ? `一句话：${analysis.one_liner}` : "",
    "",
    "中间在拆推特立项路径和网站；拆完后可在输入框上方点 **运营思路**，或直接提问。",
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

