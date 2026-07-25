"use client";

import { useEffect, useRef, useState } from "react";
import {
  chat,
  friendlyApiError,
  loadFocusToken,
  RequestAbortedError,
} from "@/lib/api";
import type { Token } from "@/lib/types";
import RichText from "@/components/RichText";
import ChatComposer, { type ChatAttachment } from "@/components/ChatComposer";
import { loadLlmPrefs, llmRequestFields, type LlmPrefs } from "@/lib/llmPrefs";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Locale } from "@/lib/i18n/locales";

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
function buildChatChips(
  focus: Token | null,
  locale: Locale,
  t: (k: string, p?: Record<string, string | number>) => string
) {
  const sym = focus?.symbol ? `$${focus.symbol}` : locale === "en" ? "this reference" : "当前对标盘";
  const nameBit =
    locale === "en"
      ? focus
        ? `Using board reference ${sym}${focus.name ? ` (${focus.name})` : ""} as a case study`
        : "Using the reference type I describe as a case study"
      : focus
        ? `以看板带入的对标 ${sym}${focus.name ? `（${focus.name}）` : ""} 为案例`
        : "以我描述的对标/热门类型为案例";

  const langNote =
    locale === "en"
      ? "Reply in English. Research only, not investment advice. Learn structure — do not copy skin."
      : "用中文回复。研究教育，非投资建议。学结构不抄皮。";

  return [
    {
      label: t("chat.chip.extend"),
      prompt: [
        `${nameBit}.`,
        locale === "en"
          ? "Produce 3–5 **similar / extension product** directions (same meta or portable structure). Not clones."
          : "请做「学结构、不抄皮」的延伸选题：产出 **3–5 个同类/延伸产品方向**（同一赛道或可迁移结构变体），不是复制。",
        "",
        locale === "en"
          ? "For each direction: portable structure · must-change skin · one-liner · difference vs original · risks. Clear Markdown."
          : "每个方向：可学结构 · 必须换的皮 · 一句话立项 · 与原盘差异 · 风险。清晰 Markdown 分节。",
        langNote,
      ].join("\n"),
    },
    {
      label: t("chat.chip.structure"),
      prompt: [
        `${nameBit}.`,
        locale === "en"
          ? "Extract only **portable structure** (narrative / identity / visual / cadence). Checklist + red lines + 3 minimal differentiators."
          : "请只拆「可复用结构」：叙事/身份/视觉/节奏；checklist；绝对不能抄的红线；同类盘最小差异化 3 刀。",
        langNote,
      ].join("\n"),
    },
    {
      label: t("chat.chip.oneliner"),
      prompt: [
        `${nameBit}.`,
        locale === "en"
          ? "Write **my own** one-liner pitch drafts (reskinned). 3 options + audience + tip + what not to copy."
          : "请写 **我自己的盘** 一句话立项草案（换皮版）3 个，并附目标人群、尖点、忌碰点；禁止复述对标口号。",
        langNote,
      ].join("\n"),
    },
  ];
}

export default function ChatPage() {
  const { t, locale } = useI18n();
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

    const tok = loadFocusToken();
    setFocus(tok);
  }, []);

  // Welcome message follows locale (and focus)
  useEffect(() => {
    if (!prefsReady) return;
    const namePart = focus?.name ? ` · ${focus.name}` : "";
    const ctx = focus?.symbol
      ? t("chat.welcome.ctx", {
          symbol: focus.symbol,
          name: namePart,
        })
      : t("chat.welcome.noCtx");
    const welcome = t("chat.welcome", { ctx });
    if (!welcomeSeeded.current) {
      welcomeSeeded.current = true;
      setMessages([{ id: uid(), role: "assistant", content: welcome }]);
      return;
    }
    // When language toggles, refresh the first assistant welcome if still the only/first system-like msg
    setMessages((prev) => {
      if (prev.length === 1 && prev[0].role === "assistant") {
        return [{ ...prev[0], content: welcome }];
      }
      return prev;
    });
  }, [locale, focus, prefsReady, t]);

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
        ...llmRequestFields(llm, locale),
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
        const msg = friendlyApiError(e, locale);
        setError(msg);
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "assistant",
            content:
              locale === "en"
                ? `${msg}\n\nIf this keeps happening, check model / API key next to the input.`
                : `${msg}\n\n若反复出现，请检查输入框旁的模型与 API Key。`,
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
      : t("chat.noModel");

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-white px-5">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold">{t("chat.title")}</h1>
          <p className="text-xs text-[var(--text-muted)]">
            {t("chat.subtitle")}
            {modelHint ? (
              <span className="ml-2 font-mono text-[10px] text-zinc-400">
                {modelHint}
              </span>
            ) : null}
          </p>
        </div>
        {focus?.symbol ? (
          <div className="hidden rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600 sm:block">
            {t("chat.context", { symbol: focus.symbol })}
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
                {m.role === "user" ? t("chat.you") : "M"}
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
            <p className="text-center text-sm text-zinc-400">
              {t("chat.thinking")}
            </p>
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
                ? t("chat.placeholderFocus", { symbol: focus.symbol })
                : t("chat.placeholder")
            }
            chips={buildChatChips(focus, locale, t)}
            onChip={(prompt) => void send(prompt)}
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
