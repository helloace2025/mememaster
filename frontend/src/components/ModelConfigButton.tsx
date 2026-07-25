"use client";

import { useEffect, useMemo, useState } from "react";
import { getHealth } from "@/lib/api";
import type { ProviderInfo } from "@/lib/types";
import {
  loadLlmPrefs,
  saveLlmPrefs,
  type LlmPrefs,
} from "@/lib/llmPrefs";

type Props = {
  value: LlmPrefs;
  onChange: (v: LlmPrefs) => void;
};

type CatalogRow = {
  key: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  tier?: string;
  configured: boolean;
  needsBaseUrl: boolean;
  needsKey: boolean;
  baseUrlDefault?: string;
  notes?: string;
  isCustomEntry?: boolean;
};

const TIER_ZH: Record<string, string> = {
  economy: "经济",
  premium: "高能",
  legacy: "兼容",
  local: "本地",
  custom: "自定义",
};

/**
 * Model picker: browse a full catalog → pick one → fill that vendor's API Key.
 */
export default function ModelConfigButton({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [draft, setDraft] = useState<LlmPrefs>(value);
  const [showKey, setShowKey] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<string>("all");
  const [step, setStep] = useState<"list" | "key">("list");

  useEffect(() => {
    getHealth()
      .then((h) => setProviders(h.llm_providers || []))
      .catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    if (!open) return;
    const loaded = { ...value, ...loadLlmPrefs() };
    setDraft(loaded);
    setQ("");
    setStep("list");
    setTab(loaded.provider || "all");
  }, [open, value]);

  const catalog: CatalogRow[] = useMemo(() => {
    const list =
      providers.length > 0
        ? providers
        : ([
            {
              id: "deepseek",
              label: "DeepSeek",
              configured: false,
              default_model: "deepseek-v4-flash",
              models: [
                {
                  id: "deepseek-v4-flash",
                  label: "V4 Flash（推荐经济）",
                  tier: "economy",
                },
                { id: "deepseek-v4-pro", label: "V4 Pro", tier: "premium" },
              ],
              needs_key: true,
              base_url: "https://api.deepseek.com",
            },
            {
              id: "openai",
              label: "OpenAI",
              configured: false,
              default_model: "gpt-4o-mini",
              models: [
                { id: "gpt-4o-mini", label: "GPT-4o mini", tier: "economy" },
                { id: "gpt-4o", label: "GPT-4o", tier: "premium" },
              ],
              needs_key: true,
              base_url: "https://api.openai.com/v1",
            },
            {
              id: "custom",
              label: "自定义 OpenAI 兼容",
              configured: false,
              models: [],
              needs_key: true,
              needs_base_url: true,
              notes: "任意兼容网关",
            },
          ] as ProviderInfo[]);

    const rows: CatalogRow[] = [];
    for (const p of list) {
      const needsBase = !!(p.needs_base_url || p.id === "custom" || p.id === "ollama");
      const needsKey = p.needs_key !== false && p.id !== "ollama";
      const models = p.models?.length
        ? p.models
        : p.default_model
          ? [{ id: p.default_model, label: p.default_model }]
          : [];

      if (p.id === "custom") {
        rows.push({
          key: "custom:manual",
          providerId: "custom",
          providerLabel: p.label,
          modelId: "",
          modelLabel: "自定义网关 · 手写 Model ID",
          tier: "custom",
          configured: p.configured,
          needsBaseUrl: true,
          needsKey: true,
          baseUrlDefault: p.base_url || "",
          notes: p.notes,
          isCustomEntry: true,
        });
        continue;
      }

      for (const m of models) {
        rows.push({
          key: `${p.id}:${m.id}`,
          providerId: p.id,
          providerLabel: p.label,
          modelId: m.id,
          modelLabel: m.label || m.id,
          tier: m.tier,
          configured: p.configured,
          needsBaseUrl: needsBase,
          needsKey,
          baseUrlDefault: p.base_url,
          notes: p.notes,
        });
      }
    }
    return rows;
  }, [providers]);

  const providerTabs = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of catalog) {
      map.set(r.providerId, r.providerLabel);
    }
    return [
      { id: "all", label: "全部" },
      ...Array.from(map.entries()).map(([id, label]) => ({ id, label })),
    ];
  }, [catalog]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return catalog.filter((r) => {
      if (tab !== "all" && r.providerId !== tab) return false;
      if (!needle) return true;
      return (
        r.modelLabel.toLowerCase().includes(needle) ||
        r.modelId.toLowerCase().includes(needle) ||
        r.providerLabel.toLowerCase().includes(needle) ||
        r.providerId.toLowerCase().includes(needle)
      );
    });
  }, [catalog, q, tab]);

  const selectedRow = useMemo(() => {
    if (draft.provider === "custom") {
      return catalog.find((r) => r.isCustomEntry) || null;
    }
    if (draft.provider && draft.model) {
      return (
        catalog.find(
          (r) => r.providerId === draft.provider && r.modelId === draft.model
        ) || null
      );
    }
    return null;
  }, [catalog, draft.provider, draft.model]);

  const activeProvider = providers.find((p) => p.id === draft.provider);
  const hasKey = !!(
    draft.apiKey ||
    activeProvider?.configured ||
    (draft.provider === "ollama")
  );

  const triggerLabel = (() => {
    if (draft.provider === "custom" && draft.model) {
      return `自定义 · ${draft.model}`;
    }
    if (selectedRow) {
      return `${short(selectedRow.providerLabel, 10)} · ${short(selectedRow.modelLabel, 16)}`;
    }
    if (draft.model) return draft.model;
    return "选择模型";
  })();

  const pickModel = (row: CatalogRow) => {
    const saved = loadLlmPrefs().byProvider?.[row.providerId];
    if (row.isCustomEntry) {
      setDraft((d) => ({
        ...d,
        provider: "custom",
        model: saved?.model || (d.provider === "custom" ? d.model || "" : ""),
        apiKey: saved?.apiKey || "",
        baseUrl: saved?.baseUrl || row.baseUrlDefault || "",
      }));
    } else {
      setDraft((d) => ({
        ...d,
        provider: row.providerId,
        model: row.modelId,
        apiKey: saved?.apiKey || (d.provider === row.providerId ? d.apiKey : ""),
        baseUrl:
          saved?.baseUrl ||
          row.baseUrlDefault ||
          (d.provider === row.providerId ? d.baseUrl : "") ||
          "",
      }));
    }
    setStep("key");
  };

  const save = () => {
    const next: LlmPrefs = {
      provider: draft.provider,
      model: (draft.model || "").trim(),
      apiKey: draft.apiKey,
      baseUrl: (draft.baseUrl || "").trim(),
    };
    if (!next.provider) {
      alert("请先从列表选择一个模型");
      return;
    }
    if (!next.model) {
      alert("请填写 Model ID");
      return;
    }
    if (next.provider === "custom" && !next.baseUrl) {
      alert("自定义网关需要填写 Base URL（通常以 /v1 结尾）");
      return;
    }
    const pInfo = providers.find((p) => p.id === next.provider);
    const needsKey =
      next.provider !== "ollama" &&
      (pInfo?.needs_key !== false);
    if (needsKey && !next.apiKey && !pInfo?.configured) {
      alert(
        "该厂商尚未在 .env 配置 Key。请在下方粘贴 API Key 后再保存。"
      );
      return;
    }
    saveLlmPrefs(next);
    onChange(loadLlmPrefs());
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 max-w-[min(56vw,260px)] items-center gap-1.5 rounded-md px-2 text-left text-[11px] font-medium transition ${
          hasKey
            ? "text-emerald-700 hover:bg-emerald-50"
            : "text-amber-700 hover:bg-amber-50"
        }`}
        title="选择模型并配置 API Key"
      >
        <GearIcon />
        <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
        {!hasKey && (
          <span className="shrink-0 rounded bg-amber-100 px-1 text-[9px] text-amber-800">
            需Key
          </span>
        )}
        <span className="shrink-0 text-[9px] opacity-50">▾</span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed left-1/2 top-[8vh] z-50 flex w-[min(96vw,440px)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
            style={{ maxHeight: "min(84vh, 640px)" }}
          >
            {/* header */}
            <div className="shrink-0 border-b border-zinc-100 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[14px] font-semibold text-zinc-900">
                    选择模型
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    先点选模型，再填写该厂商的 API Key
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-[12px] text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700"
                  onClick={() => setOpen(false)}
                >
                  关闭
                </button>
              </div>

              {/* steps */}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep("list")}
                  className={`flex-1 rounded-lg py-1.5 text-[11px] font-medium ${
                    step === "list"
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  1 · 模型列表
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!draft.provider) {
                      alert("请先选择一个模型");
                      return;
                    }
                    setStep("key");
                  }}
                  className={`flex-1 rounded-lg py-1.5 text-[11px] font-medium ${
                    step === "key"
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  2 · API Key
                </button>
              </div>
            </div>

            {step === "list" && (
              <>
                <div className="shrink-0 space-y-2 border-b border-zinc-100 px-4 py-2.5">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="搜索模型 / 厂商…"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-[13px] outline-none focus:border-emerald-300"
                  />
                  <div className="flex gap-1 overflow-x-auto pb-0.5">
                    {providerTabs.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${
                          tab === t.id
                            ? "bg-emerald-600 text-white"
                            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                        }`}
                      >
                        {short(t.label, 12)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                  {filtered.length === 0 && (
                    <p className="px-3 py-10 text-center text-[12px] text-zinc-400">
                      没有匹配的模型
                    </p>
                  )}
                  <ul className="space-y-0.5">
                    {filtered.map((row) => {
                      const active =
                        !row.isCustomEntry &&
                        draft.provider === row.providerId &&
                        draft.model === row.modelId;
                      const activeCustom =
                        row.isCustomEntry && draft.provider === "custom";
                      const on = active || activeCustom;
                      return (
                        <li key={row.key}>
                          <button
                            type="button"
                            onClick={() => pickModel(row)}
                            className={`flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left transition ${
                              on
                                ? "bg-emerald-50 ring-1 ring-emerald-200"
                                : "hover:bg-zinc-50"
                            }`}
                          >
                            <span
                              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                                on
                                  ? "border-emerald-600 bg-emerald-600 text-white"
                                  : "border-zinc-300"
                              }`}
                            >
                              {on ? (
                                <span className="text-[9px] leading-none">✓</span>
                              ) : null}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[13px] font-medium text-zinc-900">
                                  {row.modelLabel}
                                </span>
                                {row.tier && (
                                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
                                    {TIER_ZH[row.tier] || row.tier}
                                  </span>
                                )}
                                {row.configured && (
                                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">
                                    .env 已配
                                  </span>
                                )}
                              </span>
                              <span className="mt-0.5 block text-[11px] text-zinc-500">
                                {row.providerLabel}
                                {row.modelId ? (
                                  <span className="font-mono text-zinc-400">
                                    {" "}
                                    · {row.modelId}
                                  </span>
                                ) : null}
                              </span>
                            </span>
                            <span className="shrink-0 self-center text-[11px] text-emerald-700">
                              选用 →
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            )}

            {step === "key" && (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                <div className="mb-3 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                    已选模型
                  </p>
                  <p className="mt-1 text-[13px] font-semibold text-zinc-900">
                    {selectedRow?.modelLabel || draft.model || "—"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {selectedRow?.providerLabel || draft.provider || "—"}
                    {draft.model ? (
                      <span className="font-mono text-zinc-400">
                        {" "}
                        · {draft.model}
                      </span>
                    ) : null}
                  </p>
                  <button
                    type="button"
                    className="mt-2 text-[11px] text-sky-700 hover:underline"
                    onClick={() => setStep("list")}
                  >
                    ← 重新选择模型
                  </button>
                </div>

                {/* custom model id always editable when custom */}
                {(draft.provider === "custom" || !selectedRow?.modelId) && (
                  <div className="mb-3">
                    <label className="mb-1 block text-[11px] font-medium text-zinc-600">
                      Model ID <span className="text-rose-500">*</span>
                    </label>
                    <input
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 font-mono text-[12px]"
                      placeholder="例如 my-gateway-model-v1"
                      value={draft.model || ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, model: e.target.value }))
                      }
                      spellCheck={false}
                    />
                  </div>
                )}

                {/* allow override model id even for presets */}
                {draft.provider &&
                  draft.provider !== "custom" &&
                  selectedRow?.modelId && (
                    <div className="mb-3">
                      <label className="mb-1 block text-[11px] font-medium text-zinc-600">
                        Model ID
                        <span className="ml-1 font-normal text-zinc-400">
                          （可改成同厂商其它 id）
                        </span>
                      </label>
                      <input
                        className="w-full rounded-lg border border-zinc-200 px-3 py-2 font-mono text-[12px]"
                        value={draft.model || ""}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, model: e.target.value }))
                        }
                        spellCheck={false}
                      />
                    </div>
                  )}

                {(draft.provider === "custom" ||
                  draft.provider === "ollama" ||
                  selectedRow?.needsBaseUrl) && (
                  <div className="mb-3">
                    <label className="mb-1 block text-[11px] font-medium text-zinc-600">
                      Base URL
                      {draft.provider === "custom" ? (
                        <span className="text-rose-500"> *</span>
                      ) : null}
                    </label>
                    <input
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 font-mono text-[12px]"
                      placeholder={
                        draft.provider === "ollama"
                          ? "http://127.0.0.1:11434/v1"
                          : "https://api.example.com/v1"
                      }
                      value={draft.baseUrl || ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, baseUrl: e.target.value }))
                      }
                      spellCheck={false}
                    />
                    <p className="mt-1 text-[10px] text-zinc-400">
                      OpenAI 兼容根路径，通常以 /v1 结尾
                    </p>
                  </div>
                )}

                {draft.provider !== "ollama" && (
                  <div className="mb-3">
                    <label className="mb-1 flex items-center justify-between text-[11px] font-medium text-zinc-600">
                      <span>
                        API Key
                        {!activeProvider?.configured &&
                        draft.provider !== "ollama" ? (
                          <span className="text-rose-500"> *</span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        className="text-[11px] text-zinc-400 hover:text-zinc-600"
                        onClick={() => setShowKey((v) => !v)}
                      >
                        {showKey ? "隐藏" : "显示"}
                      </button>
                    </label>
                    <input
                      type={showKey ? "text" : "password"}
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 font-mono text-[12px]"
                      placeholder={
                        activeProvider?.configured
                          ? "可选：覆盖 .env（留空则用服务端）"
                          : `粘贴 ${selectedRow?.providerLabel || "该厂商"} 的 API Key`
                      }
                      value={draft.apiKey || ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, apiKey: e.target.value }))
                      }
                      autoComplete="off"
                    />
                    <p className="mt-1.5 text-[10px] leading-snug text-zinc-400">
                      Key 只存在本机浏览器，请求经本地后端转发，不会上传到第三方。
                      {activeProvider?.configured
                        ? " 服务端 .env 已有 Key，可留空。"
                        : ""}
                    </p>
                  </div>
                )}

                {selectedRow?.notes && (
                  <p className="mb-2 text-[11px] text-zinc-400">
                    {selectedRow.notes}
                  </p>
                )}
              </div>
            )}

            {/* footer */}
            <div className="shrink-0 border-t border-zinc-100 bg-white px-4 py-3">
              {step === "list" ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-[13px] text-zinc-600 hover:bg-zinc-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!draft.provider || !draft.model) {
                        alert("请先点选一个模型");
                        return;
                      }
                      setStep("key");
                    }}
                    className="flex-1 rounded-xl bg-zinc-900 py-2.5 text-[13px] font-medium text-white hover:bg-zinc-800"
                  >
                    下一步：填 API Key
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStep("list")}
                    className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-[13px] text-zinc-600 hover:bg-zinc-50"
                  >
                    上一步
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-[13px] font-medium text-white hover:bg-emerald-500"
                  >
                    保存并使用
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function short(s: string, n: number) {
  if (!s) return s;
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function GearIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
