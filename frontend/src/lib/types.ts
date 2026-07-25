export type Token = {
  chain: string;
  address: string;
  symbol: string;
  name: string;
  logo?: string;
  price?: number | null;
  market_cap?: number | null;
  liquidity?: number | null;
  volume?: number | null;
  price_change_percent?: number | null;
  holder_count?: number | null;
  smart_degen_count?: number;
  renowned_count?: number;
  rug_ratio?: number | null;
  top_10_holder_rate?: number | null;
  creator_token_status?: string;
  twitter_username?: string;
  /** ok | missing | dead — dead = numeric id / deleted, no research value */
  twitter_status?: "ok" | "missing" | "dead" | string;
  twitter_raw?: string;
  skip_research?: boolean;
  website?: string;
  telegram?: string;
  launchpad_platform?: string;
  rank?: number;
  open_timestamp?: number | null;
  creation_timestamp?: number | null;
  age_hours?: number | null;
  price_change_percent1h?: number | null;
  price_change_percent5m?: number | null;
  swaps?: number | null;
  buys?: number | null;
  sells?: number | null;
  is_honeypot?: boolean | number | null;
  is_wash_trading?: boolean | number | null;
};

export type ScoreBox = { score?: number; note?: string };

/** One dimension of builder guidance (narrative / visual / website / twitter) */
export type GuideBlock = {
  summary?: string;
  do?: string[];
  dont?: string[];
  checklist?: string[];
  // narrative
  one_liner_template?: string;
  differentiator?: string;
  // visual
  character?: string;
  style_keywords?: string[];
  assets?: string[];
  // website
  has_site?: boolean;
  modules?: string[];
  ia_outline?: string[];
  // twitter
  persona?: string;
  cadence?: string;
  content_mix?: string[];
  pre_ca_playbook?: string[];
  sample_angles?: string[];
};

export type AnalysisGuide = {
  narrative?: GuideBlock;
  visual?: GuideBlock;
  website?: GuideBlock;
  twitter?: GuideBlock;
};

export type Analysis = {
  narrative_type?: string;
  track?: string;
  ip_angle?: string;
  one_liner?: string;
  emotional_hook?: string;
  desire?: ScoreBox;
  game?: ScoreBox;
  trust?: ScoreBox;
  ip_strength?: {
    memeable?: number;
    ownable?: number;
    visualizable?: number;
  };
  why_hot_today?: string;
  risks?: string[];
  lesson_for_builder?: string;
  copy_vs_create?: string;
  verdict?: string;
  confidence?: number;
  guide?: AnalysisGuide;
  source?: string;
  provider?: string;
  model?: string;
  llm_error?: string;
};

export type ModelOption = { id: string; label: string; tier?: string };

export type ProviderInfo = {
  id: string;
  label: string;
  configured: boolean;
  env_configured?: boolean;
  default_model?: string;
  models?: ModelOption[];
  notes?: string;
  base_url?: string;
  needs_key?: boolean;
  needs_base_url?: boolean;
  api_style?: string;
};

export type Health = {
  ok?: boolean;
  gmgn_key?: boolean;
  opennews_token?: boolean;
  llm_key?: boolean;
  llm_active?: { id?: string; label?: string; model?: string } | null;
  llm_providers?: ProviderInfo[];
  disclaimer?: string;
};

export type ChainBlock = {
  chain: string;
  ok: boolean;
  error?: string;
  count: number;
  tokens: Token[];
};

/** GMGN market trending 支持的全部链 */
export const CHAINS = [
  { id: "sol", label: "Solana", short: "SOL" },
  { id: "bsc", label: "BSC", short: "BSC" },
  { id: "base", label: "Base", short: "BASE" },
  { id: "eth", label: "Ethereum", short: "ETH" },
  { id: "robinhood", label: "Robinhood", short: "RH" },
] as const;

export const ALL_CHAIN_IDS = CHAINS.map((c) => c.id);

/**
 * API origin for browser fetches.
 * - Local dev: default http://127.0.0.1:8000
 * - Unified Railway image: set NEXT_PUBLIC_API_BASE="" at build → same-origin /api/*
 * - Split FE service: set full API URL e.g. https://xxx.up.railway.app
 */
function resolveApiBase(): string {
  const v = process.env.NEXT_PUBLIC_API_BASE;
  if (v === "" || v === "same" || v === "/") return "";
  if (typeof v === "string" && v.length > 0) return v.replace(/\/$/, "");
  return "http://127.0.0.1:8000";
}

export const API_BASE = resolveApiBase();

export const TOKEN_CACHE_KEY = "mm_focus_token";
