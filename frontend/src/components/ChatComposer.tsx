"use client";

import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  useRef,
  useState,
} from "react";
import type { LlmPrefs } from "@/lib/llmPrefs";
import ModelConfigButton from "@/components/ModelConfigButton";
import { useI18n } from "@/lib/i18n/I18nProvider";

export type ChatAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  text?: string;
  previewUrl?: string;
};

/** Short label on the button; prompt is what gets sent (defaults to label). */
export type ChatChip = string | { label: string; prompt: string };

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: (payload: { text: string; attachments: ChatAttachment[] }) => void;
  /** Stop / interrupt in-flight AI reply */
  onStop?: () => void;
  busy?: boolean;
  placeholder?: string;
  chips?: ChatChip[];
  onChip?: (text: string) => void;
  /** Default quick action above the input (e.g. 运营思路) — not a loud header CTA */
  primaryAction?: {
    label: string;
    onClick: () => void;
    busy?: boolean;
  };
  /** LLM config next to attach button */
  llm?: LlmPrefs;
  onLlmChange?: (v: LlmPrefs) => void;
};

const ACCEPT =
  ".txt,.md,.markdown,.json,.csv,.log,.pdf,image/png,image/jpeg,image/webp,image/gif,text/*";

export default function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  placeholder,
  chips,
  onChip,
  primaryAction,
  llm,
  onLlmChange,
}: Props) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ChatAttachment[]>([]);

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const hit = prev.find((f) => f.id === id);
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  const onPickFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    const next: ChatAttachment[] = [];
    for (const file of Array.from(list)) {
      if (file.size > 4 * 1024 * 1024) continue;
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const item: ChatAttachment = {
        id,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
      };
      if (file.type.startsWith("image/")) {
        item.previewUrl = URL.createObjectURL(file);
      } else if (
        file.type.startsWith("text/") ||
        /\.(md|txt|json|csv|log|markdown)$/i.test(file.name)
      ) {
        try {
          item.text = (await file.text()).slice(0, 40000);
        } catch {
          /* */
        }
      } else if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        item.text = `[PDF 附件: ${file.name}，请粘贴关键段落到对话]`;
      } else {
        item.text = `[附件: ${file.name}]`;
      }
      next.push(item);
    }
    setFiles((prev) => [...prev, ...next].slice(0, 8));
    e.target.value = "";
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = value.trim();
    if ((!text && files.length === 0) || busy) return;
    onSend({ text: text || "（见附件）", attachments: files });
    setFiles((prev) => {
      prev.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
      return [];
    });
    onChange("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const canSend = !busy && (value.trim().length > 0 || files.length > 0);

  const showActions = !!primaryAction || !!chips?.length;

  return (
    <div className="shrink-0 border-t border-zinc-200 bg-white px-3 pb-3 pt-2.5">
      {showActions && (
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          {primaryAction && (
            <button
              type="button"
              disabled={busy || primaryAction.busy}
              onClick={() => primaryAction.onClick()}
              className="border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {primaryAction.busy ? "生成中…" : primaryAction.label}
            </button>
          )}
          {chips?.map((c) => {
            const label = typeof c === "string" ? c : c.label;
            const prompt = typeof c === "string" ? c : c.prompt;
            return (
              <button
                key={label}
                type="button"
                disabled={busy || primaryAction?.busy}
                title={prompt.length > 40 ? prompt.slice(0, 120) + "…" : prompt}
                onClick={() => onChip?.(prompt)}
                className="border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
              >
                {label.length > 22 ? label.slice(0, 22) + "…" : label}
              </button>
            );
          })}
        </div>
      )}

      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex max-w-full items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[11px] text-zinc-700"
            >
              {f.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={f.previewUrl}
                  alt=""
                  className="h-7 w-7 rounded-md object-cover"
                />
              ) : (
                <span className="text-zinc-400">📎</span>
              )}
              <span className="max-w-[140px] truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => removeFile(f.id)}
                className="ml-0.5 text-zinc-400 hover:text-zinc-700"
                aria-label="移除"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input box — straight edges, readable type */}
      <form
        onSubmit={submit}
        className="overflow-hidden border border-zinc-200 bg-white transition focus-within:border-zinc-400 focus-within:ring-1 focus-within:ring-zinc-200"
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={onPickFiles}
        />

        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={4}
          placeholder={placeholder || t("composer.placeholder")}
          disabled={busy}
          className="min-h-[104px] w-full resize-none bg-transparent px-3.5 pb-2 pt-3.5 text-[13.5px] leading-[1.7] text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-60"
        />

        <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-2 py-1.5">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex h-9 w-9 items-center justify-center text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-40"
              title={t("composer.attach")}
              aria-label={t("composer.attach")}
            >
              <PaperclipIcon />
            </button>
            {llm && onLlmChange && (
              <ModelConfigButton value={llm} onChange={onLlmChange} />
            )}
          </div>

          {busy ? (
            <button
              type="button"
              onClick={() => onStop?.()}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-white shadow-sm transition hover:bg-zinc-800"
              title={t("composer.stop")}
              aria-label={t("composer.stop")}
            >
              <StopSquareIcon />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className={`flex h-9 w-9 items-center justify-center transition ${
                canSend
                  ? "bg-zinc-900 text-white hover:bg-zinc-800"
                  : "bg-zinc-100 text-zinc-300"
              }`}
              title={t("composer.send")}
              aria-label={t("composer.send")}
            >
              <SendArrowIcon />
            </button>
          )}
        </div>
      </form>

      <p className="mt-1.5 text-center text-[10px] text-zinc-400">
        {busy ? t("composer.hintBusy") : t("composer.hint")}
      </p>
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 01-7.78-7.78l8.49-8.49a3.5 3.5 0 014.95 4.95l-8.5 8.49a1.5 1.5 0 01-2.12-2.12l7.78-7.78" />
    </svg>
  );
}

function SendArrowIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
    >
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

/** Circle button with square — stop / interrupt AI */
function StopSquareIcon() {
  return (
    <span
      className="block h-2.5 w-2.5 rounded-[1px] bg-white"
      aria-hidden
    />
  );
}
