import {
  API_BASE,
  ALL_CHAIN_IDS,
  Health,
  Token,
  Analysis,
  ChainBlock,
} from "./types";
import { friendlyFetchError } from "./format";

export class RequestAbortedError extends Error {
  constructor(message = "已停止生成") {
    super(message);
    this.name = "RequestAbortedError";
  }
}

function isAbortError(e: unknown) {
  if (!e || typeof e !== "object") return false;
  const name = (e as { name?: string }).name;
  return name === "AbortError" || name === "RequestAbortedError";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
  } catch (e) {
    if (isAbortError(e) || init?.signal?.aborted) {
      throw new RequestAbortedError();
    }
    throw new Error(friendlyFetchError(e));
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function getHealth() {
  return request<Health>("/api/health");
}

export async function getHot(opts: {
  chains?: string[];
  interval?: string;
  limit?: number;
  /** e.g. 24h | 3d | 7d | 14d | 30d | all */
  max_created?: string;
}) {
  const q = new URLSearchParams({
    interval: opts.interval || "24h",
    limit: String(opts.limit ?? 20),
    chains: (opts.chains || [...ALL_CHAIN_IDS]).join(","),
  });
  if (opts.max_created) {
    q.set("max_created", opts.max_created);
  }
  return request<{
    interval: string;
    max_created?: string;
    by_chain: Record<string, ChainBlock>;
    disclaimer?: string;
  }>(`/api/hot?${q}`);
}

/** Lookup a custom token by CA (not limited to hot board). */
export function getToken(opts: {
  chain: string;
  address: string;
  /** try other chains if miss */
  probe?: boolean;
}) {
  const q = new URLSearchParams({
    chain: opts.chain,
    address: opts.address.trim(),
  });
  if (opts.probe) q.set("probe", "true");
  return request<{
    ok: boolean;
    chain: string;
    address: string;
    token: Token;
    probed?: boolean;
    disclaimer?: string;
  }>(`/api/token?${q}`);
}

/** Heuristic: pasted contract / mint address (Sol base58 or EVM 0x). */
export function looksLikeContractAddress(raw: string): boolean {
  const s = raw.trim();
  if (!s || s.includes(" ")) return false;
  if (/^0x[a-fA-F0-9]{40}$/.test(s)) return true;
  // Solana mint: base58, typically 32–44 chars
  if (/^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(s)) return true;
  return false;
}

export type LlmOpts = {
  provider?: string;
  model?: string;
  api_key?: string;
  base_url?: string;
};

export function analyzeToken(token: Token, opts?: LlmOpts) {
  return request<{ analysis: Analysis; twitter?: unknown }>(`/api/analyze`, {
    method: "POST",
    body: JSON.stringify({
      chain: token.chain,
      address: token.address,
      token,
      include_twitter: true,
      provider: opts?.provider,
      model: opts?.model,
      api_key: opts?.api_key,
      base_url: opts?.base_url,
    }),
  });
}

export function twitterOps(
  opts: {
    username?: string;
    token?: Token;
    question?: string;
    max_tweets?: number;
  } & LlmOpts
) {
  return request<{
    ok: boolean;
    username?: string;
    content: string;
    tweet_count?: number;
    tweets?: unknown[];
    profile?: unknown;
    source?: string;
    provider?: string;
    model?: string;
  }>(`/api/twitter/ops`, {
    method: "POST",
    body: JSON.stringify({
      username: opts.username,
      token: opts.token,
      question:
        opts.question ||
        "还原立项路径：第一条推文怎么切入、概念怎么讲、项目怎么推、配图视觉系统怎么立",
      max_tweets: opts.max_tweets ?? 25,
      provider: opts.provider,
      model: opts.model,
      api_key: opts.api_key,
      base_url: opts.base_url,
    }),
  });
}

export function websiteOps(
  opts: {
    url?: string;
    token?: Token;
  } & LlmOpts
) {
  return request<{
    ok: boolean;
    url?: string;
    final_url?: string;
    content: string;
    fetch?: {
      title?: string;
      tech_hints?: string[];
      social_links?: { href: string; label: string }[];
      status_code?: number;
    };
    source?: string;
    provider?: string;
    model?: string;
  }>(`/api/website/ops`, {
    method: "POST",
    body: JSON.stringify({
      url: opts.url,
      token: opts.token,
      provider: opts.provider,
      model: opts.model,
      api_key: opts.api_key,
      base_url: opts.base_url,
    }),
  });
}

export function chat(
  opts: {
    message: string;
    history?: { role: string; content: string }[];
    context?: Record<string, unknown>;
    signal?: AbortSignal;
  } & LlmOpts
) {
  const { signal, ...body } = opts;
  return request<{ content: string; provider?: string; model?: string }>(
    `/api/chat`,
    {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }
  );
}

/** Generate ops playbook from left/middle panel materials */
export function generatePlaybook(
  opts: {
    token?: Token;
    analysis?: Analysis | null;
    twitter_ops?: string;
    website_ops?: string;
    scores?: { id: string; label: string; score: number; note: string }[];
    note?: string;
    signal?: AbortSignal;
  } & LlmOpts
) {
  const { signal, ...body } = opts;
  return request<{
    content: string;
    symbol?: string;
    provider?: string;
    model?: string;
    source?: string;
  }>(`/api/playbook`, {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
}

export function saveFocusToken(token: Token) {
  try {
    sessionStorage.setItem("mm_focus_token", JSON.stringify(token));
  } catch {
    /* ignore */
  }
}

export function loadFocusToken(): Token | null {
  try {
    const raw = sessionStorage.getItem("mm_focus_token");
    if (!raw) return null;
    return JSON.parse(raw) as Token;
  } catch {
    return null;
  }
}
