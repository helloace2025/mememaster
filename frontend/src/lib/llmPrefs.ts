/** Persist LLM vendor / model / API key in the browser (local only) */

const KEY = "mm_llm_prefs_v2";

export type ProviderCreds = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export type LlmPrefs = {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  /** Per-vendor saved keys so switching keeps credentials */
  byProvider?: Record<string, ProviderCreds>;
};

export function loadLlmPrefs(): LlmPrefs {
  if (typeof window === "undefined") return {};
  try {
    // migrate v1
    const v2 = localStorage.getItem(KEY);
    if (v2) {
      const j = JSON.parse(v2) as LlmPrefs;
      return normalize(j);
    }
    const v1 = localStorage.getItem("mm_llm_prefs_v1");
    if (v1) {
      const j = JSON.parse(v1) as { provider?: string; model?: string };
      const migrated: LlmPrefs = {
        provider: j.provider,
        model: j.model,
        byProvider: {},
      };
      saveLlmPrefs(migrated);
      return migrated;
    }
    return {};
  } catch {
    return {};
  }
}

function normalize(j: LlmPrefs): LlmPrefs {
  const by = { ...(j.byProvider || {}) };
  const provider = j.provider || undefined;
  if (provider && (j.apiKey || j.baseUrl || j.model)) {
    by[provider] = {
      ...by[provider],
      apiKey: j.apiKey || by[provider]?.apiKey,
      baseUrl: j.baseUrl || by[provider]?.baseUrl,
      model: j.model || by[provider]?.model,
    };
  }
  const active = provider ? by[provider] : undefined;
  return {
    provider,
    model: j.model || active?.model,
    apiKey: j.apiKey || active?.apiKey,
    baseUrl: j.baseUrl || active?.baseUrl,
    byProvider: by,
  };
}

export function saveLlmPrefs(p: LlmPrefs) {
  if (typeof window === "undefined") return;
  try {
    const prev = loadLlmPrefs();
    const by = { ...(prev.byProvider || {}), ...(p.byProvider || {}) };
    const provider = p.provider ?? prev.provider;
    if (provider) {
      by[provider] = {
        ...by[provider],
        apiKey: p.apiKey !== undefined ? p.apiKey : by[provider]?.apiKey,
        baseUrl: p.baseUrl !== undefined ? p.baseUrl : by[provider]?.baseUrl,
        model: p.model !== undefined ? p.model : by[provider]?.model,
      };
    }
    const next: LlmPrefs = {
      provider,
      model: p.model ?? prev.model,
      apiKey: p.apiKey !== undefined ? p.apiKey : prev.apiKey,
      baseUrl: p.baseUrl !== undefined ? p.baseUrl : prev.baseUrl,
      byProvider: by,
    };
    // sync active fields from byProvider
    if (next.provider && by[next.provider]) {
      next.apiKey = by[next.provider].apiKey || next.apiKey;
      next.baseUrl = by[next.provider].baseUrl || next.baseUrl;
      next.model = by[next.provider].model || next.model;
    }
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* */
  }
}

/** Payload fragment for API calls */
export function llmRequestFields(p: LlmPrefs) {
  return {
    provider: p.provider || undefined,
    model: p.model || undefined,
    api_key: p.apiKey || undefined,
    base_url: p.baseUrl || undefined,
  };
}
