"use client";

import { useEffect, useRef, useState } from "react";
import { chat, loadFocusToken, RequestAbortedError } from "@/lib/api";
import type { Token } from "@/lib/types";
import RichText from "@/components/RichText";
import ChatComposer, { type ChatAttachment } from "@/components/ChatComposer";
import { loadLlmPrefs, llmRequestFields, type LlmPrefs } from "@/lib/llmPrefs";

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  files?: { name: string }[];
};

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Preset chips: case study → extend (learn structure, not copy). */
function buildChatChips(focus: Token | null) {
  const sym = focus?.symbol ? `$${focus.symbol}` : "当前对标盘";
  const nameBit = focus
    ? `以看板带入的对标 ${sym}${focus.name ? `（${focus.name}）` : ""} 为案例`
    : "以我描述的对标/热门类型为案例";

  return [
    {
      label: "同类延伸选题",
      prompt: [
        `${nameBit}，请做「学结构、不抄皮」的延伸选题。`,
        "",
        "目标：不是复制这个币，而是拆它为什么能热，再产出 **3–5 个同类/延伸产品方向**（同一赛道或可迁移结构的变体）。",
        "",
        "请用清晰 Markdown，每个方向单独一小节：",
        "### 方向 N：名称草案",
        "- **可学结构**（从对标迁移什么：情绪/身份/玩法/节奏，勿抄商标与角色皮）",
        "- **必须换的皮**（名字、IP、文案、视觉差异点）",
        "- **一句话立项**（小孩也能复述）",
        "- **和原盘的差异**（为什么不是山寨）",
        "- **风险**（同质化/版权/叙事撞车）",
        "",
        "最后给一段「怎么选」的简短建议。研究教育用途，非投资建议。",
      ].join("\n"),
    },
    {
      label: "可迁移结构清单",
      prompt: [
        `${nameBit}，请只拆「可复用结构」，不要给照抄方案。`,
        "",
        "输出：",
        "## 1. 它的热度结构（叙事钩子 / 身份口令 / 视觉门面 / 社交节奏，各 1–3 点，有证据写证据）",
        "## 2. 可迁移到我盘的 checklist（`- [ ]`）",
        "## 3. 绝对不能抄的红线（皮相、假官方、商标等）",
        "## 4. 若我做同类盘，最小差异化 3 刀",
        "",
        "学结构不抄皮。非投资建议。",
      ].join("\n"),
    },
    {
      label: "我的盘一句话立项",
      prompt: [
        `${nameBit}，请基于其结构，帮我写 **我自己的盘** 的立项表述（换皮后的版本）。`,
        "",
        "输出：",
        "1. 对标结构一句话（它在卖什么情绪/身份）",
        "2. 我的盘 3 个一句话立项草案（可直接当 bio/首屏）",
        "3. 每个草案附：目标人群、差异尖点、忌碰点",
        "4. 推荐采用哪一个及原因",
        "",
        "禁止复述对标原文口号当我的方案。非投资建议。",
      ].join("\n"),
    },
  ];
}

export default function ChatPage() {
  const [focus, setFocus] = useState<Token | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Empty on SSR + first client paint — load localStorage only after mount (avoids hydration mismatch)
  const [llm, setLlm] = useState<LlmPrefs>({});
  const [prefsReady, setPrefsReady] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const welcomeSeeded = useRef(false);

  useEffect(() => {
    setLlm(loadLlmPrefs());
    setPrefsReady(true);

    const t = loadFocusToken();
    setFocus(t);
    if (welcomeSeeded.current) return;
    welcomeSeeded.current = true;
    const ctx = t?.symbol
      ? `当前上下文：**$${t.symbol}**${t.name ? ` · ${t.name}` : ""}。以下快捷提问会以它为**案例**做延伸，而不是照抄。`
      : `尚未带入看板代币。可先去「看板」点进一个热门盘，或在输入框里描述对标类型（如 AI meme / 动物盘）。`;
    setMessages([
      {
        id: uid(),
        role: "assistant",
        content: [
          "这里是**共创对话**：用热门盘当**案例**，学可迁移结构，产出**同类/延伸产品**选题。",
          "",
          "- 对标 = 结构参考，不是文案与角色皮的复制模板",
          "- 扫盘去「看板」；拆单盘去分析工作台",
          "",
          ctx,
          "",
          "下方快捷按钮：**同类延伸选题** · **可迁移结构** · **我的盘一句话立项**。",
        ].join("\n"),
      },
    ]);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const send = async (raw: string, attachments: ChatAttachment[] = []) => {
    const text = raw.trim();
    if ((!text && !attachments.length) || busy) return;

    let message = text;
    if (attachments.length) {
      const parts = attachments
        .filter((a) => a.text)
        .map((a) => `【附件 ${a.name}】\n${a.text}`);
      if (parts.length) {
        message = [text, "", ...parts].filter(Boolean).join("\n");
      }
    }

    setInput("");
    setBusy(true);
    setError(null);
    const userMsg: Msg = {
      id: uid(),
      role: "user",
      content: text || "（附件）",
      files: attachments.map((a) => ({ name: a.name })),
    };
    setMessages((m) => [...m, userMsg]);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const history = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await chat({
        message,
        history: history.slice(0, -1),
        signal: ac.signal,
        ...llmRequestFields(llm),
        context: focus
          ? {
              focus_token: {
                chain: focus.chain,
                address: focus.address,
                symbol: focus.symbol,
                name: focus.name,
                twitter_username: focus.twitter_username,
              },
            }
          : undefined,
      });
      const used =
        res.provider && res.model
          ? `\n\n— _${res.provider} · ${res.model}_`
          : "";
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "assistant",
          content: (res.content || "（空）") + used,
        },
      ]);
    } catch (e) {
      if (e instanceof RequestAbortedError) {
        setMessages((m) => [
          ...m,
          { id: uid(), role: "assistant", content: "（已停止生成）" },
        ]);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "assistant",
            content: `请求失败：${msg}\n\n请检查后端是否在运行，以及模型/API Key 是否在输入框旁配置正确。`,
          },
        ]);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  // Stable placeholder until prefs hydrate — never differ SSR vs first client paint
  const modelHint = !prefsReady
    ? ""
    : llm.provider || llm.model
      ? `${llm.provider || "auto"}${llm.model ? ` · ${llm.model}` : ""}`
      : "未选模型（用 .env 默认）";

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-white px-5">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold">共创对话</h1>
          <p className="text-xs text-[var(--text-muted)]">
            选题 · 结构延伸 · 同类产品
            {modelHint ? (
              <span className="ml-2 font-mono text-[10px] text-zinc-400">
                {modelHint}
              </span>
            ) : null}
          </p>
        </div>
        {focus?.symbol ? (
          <div className="hidden rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600 sm:block">
            上下文：{focus.symbol}
          </div>
        ) : null}
      </header>

      <div className="mm-scroll min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  m.role === "user"
                    ? "bg-zinc-900 text-white"
                    : "bg-[var(--accent-soft)] text-[var(--accent)]"
                }`}
              >
                {m.role === "user" ? "你" : "M"}
              </div>
              <div
                className={`max-w-[min(100%,36rem)] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
                  m.role === "user"
                    ? "bg-zinc-100"
                    : "bg-white shadow-[var(--shadow)] ring-1 ring-black/[0.04]"
                }`}
              >
                {m.role === "assistant" ? (
                  <RichText text={m.content} />
                ) : (
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                )}
                {m.files && m.files.length > 0 && (
                  <div className="mt-2 border-t border-zinc-200/80 pt-1.5 text-[11px] text-zinc-400">
                    {m.files.map((f) => f.name).join("、")}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <p className="text-center text-sm text-zinc-400">思考中…</p>
          )}
          {error && (
            <p className="text-center text-sm text-rose-600">{error}</p>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--border)] bg-white px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <ChatComposer
            value={input}
            onChange={setInput}
            busy={busy}
            onStop={stop}
            placeholder={
              focus?.symbol
                ? `以 $${focus.symbol} 为案例，问：同类还能做什么？结构怎么迁？…`
                : "描述对标类型或你的 idea；或先从看板带入一个热门盘…"
            }
            chips={buildChatChips(focus)}
            onChip={(t) => void send(t)}
            llm={llm}
            onLlmChange={setLlm}
            onSend={({ text, attachments }) => {
              void send(text, attachments);
            }}
          />
        </div>
      </div>
    </div>
  );
}
