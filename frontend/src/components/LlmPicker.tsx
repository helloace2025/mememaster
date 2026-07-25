"use client";

import { useEffect, useMemo, useState } from "react";
import { getHealth } from "@/lib/api";
import type { Health, ProviderInfo } from "@/lib/types";
import { loadLlmPrefs, saveLlmPrefs } from "@/lib/llmPrefs";

export type LlmSelection = {
  provider?: string;
  model?: string;
};

type Props = {
  value: LlmSelection;
  onChange: (v: LlmSelection) => void;
  compact?: boolean;
};

export default function LlmPicker({ value, onChange, compact }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [customModel, setCustomModel] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const providers = useMemo(
    () => (health?.llm_providers || []).filter((p) => p.configured),
    [health]
  );

  // hydrate from server default once if empty
  useEffect(() => {
    if (value.provider || value.model) return;
    const saved = loadLlmPrefs();
    if (saved.provider || saved.model) {
      onChange(saved);
      if (saved.model && !providers.some((p) => p.models?.some((m) => m.id === saved.model))) {
        setCustomModel(saved.model);
      }
      return;
    }
    if (health?.llm_active) {
      onChange({
        provider: health.llm_active.id,
        model: health.llm_active.model,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health]);

  const activeProvider: ProviderInfo | undefined =
    providers.find((p) => p.id === value.provider) || providers[0];

  const models = activeProvider?.models || [];
  const label =
    value.model ||
    activeProvider?.default_model ||
    health?.llm_active?.model ||
    "未配置模型";

  const apply = (next: LlmSelection) => {
    onChange(next);
    saveLlmPrefs(next);
  };

  if (compact) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="max-w-[160px] truncate rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[10px] text-zinc-600 hover:bg-zinc-50"
          title="切换对话模型"
        >
          模型 · {label}
        </button>
        {open && (
          <div className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg">
            <PickerBody
              providers={providers}
              value={value}
              models={models}
              customModel={customModel}
              setCustomModel={setCustomModel}
              apply={(v) => {
                apply(v);
                setOpen(false);
              }}
              activeProvider={activeProvider}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-100 bg-zinc-50/80 p-2">
      <p className="mb-1.5 text-[10px] font-semibold text-zinc-500">
        对话模型（用你配置的 API Key）
      </p>
      <PickerBody
        providers={providers}
        value={value}
        models={models}
        customModel={customModel}
        setCustomModel={setCustomModel}
        apply={apply}
        activeProvider={activeProvider}
      />
      {!providers.length && (
        <p className="mt-1 text-[10px] text-amber-700">
          后端未检测到可用 Key，请在 .env 填写 DEEPSEEK_API_KEY 等
        </p>
      )}
    </div>
  );
}

function PickerBody({
  providers,
  value,
  models,
  customModel,
  setCustomModel,
  apply,
  activeProvider,
}: {
  providers: ProviderInfo[];
  value: LlmSelection;
  models: { id: string; label: string; tier?: string }[];
  customModel: string;
  setCustomModel: (s: string) => void;
  apply: (v: LlmSelection) => void;
  activeProvider?: ProviderInfo;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] text-zinc-400">厂商</label>
      <select
        className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[12px] text-zinc-800"
        value={value.provider || activeProvider?.id || ""}
        onChange={(e) => {
          const id = e.target.value;
          const p = providers.find((x) => x.id === id);
          const m = p?.models?.[0]?.id || p?.default_model || "";
          apply({ provider: id, model: m });
        }}
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>

      <label className="block text-[10px] text-zinc-400">模型</label>
      <select
        className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[12px] text-zinc-800"
        value={
          models.some((m) => m.id === value.model)
            ? value.model
            : customModel
              ? "__custom__"
              : models[0]?.id || ""
        }
        onChange={(e) => {
          if (e.target.value === "__custom__") {
            apply({
              provider: value.provider || activeProvider?.id,
              model: customModel || "",
            });
            return;
          }
          apply({
            provider: value.provider || activeProvider?.id,
            model: e.target.value,
          });
        }}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
        <option value="__custom__">自定义模型 ID…</option>
      </select>

      {(customModel ||
        (value.model && !models.some((m) => m.id === value.model))) && (
        <input
          className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 font-mono text-[11px] text-zinc-800"
          placeholder="自定义 model id"
          value={customModel || value.model || ""}
          onChange={(e) => {
            setCustomModel(e.target.value);
            apply({
              provider: value.provider || activeProvider?.id,
              model: e.target.value.trim(),
            });
          }}
        />
      )}
    </div>
  );
}
