/**
 * Client-side cache for dashboard hot list.
 * - memory (same tab SPA navigations)
 * - sessionStorage (survives component unmount / remount)
 * Stale-while-revalidate: show cache instantly, refresh in background when past TTL.
 */

import { getHot } from "./api";
import type { ChainBlock, Token } from "./types";
import { ALL_CHAIN_IDS } from "./types";

export type HotCachePayload = {
  interval: string;
  limit: number;
  maxCreated: string;
  chains: string[];
  byChain: Record<string, Token[]>;
  chainErrors: Record<string, string>;
  fetchedAt: number;
};

const STORAGE_KEY = "mm_hot_board_v3"; // v3: max_created / new-coin filter
const UI_KEY = "mm_hot_board_ui_v3";
/** default TTL: 3 minutes */
export const HOT_CACHE_TTL_MS = 3 * 60 * 1000;

type UiPrefs = {
  chain: string;
  interval: string;
  limit: number;
  maxCreated: string;
};

// in-memory store for instant SPA switches
let memory: HotCachePayload | null = null;
let inflight: Promise<HotCachePayload> | null = null;
let inflightKey = "";

function cacheKey(
  interval: string,
  limit: number,
  maxCreated: string,
  chains: string[]
) {
  return `${interval}|${limit}|${maxCreated}|${chains.slice().sort().join(",")}`;
}

function readStorage(): HotCachePayload | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as HotCachePayload;
    if (!data?.fetchedAt || !data.byChain) return null;
    return data;
  } catch {
    return null;
  }
}

function writeStorage(payload: HotCachePayload) {
  memory = payload;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

export function peekHotCache(opts: {
  interval: string;
  limit: number;
  maxCreated: string;
  chains?: string[];
}): HotCachePayload | null {
  const chains = opts.chains || [...ALL_CHAIN_IDS];
  const key = cacheKey(opts.interval, opts.limit, opts.maxCreated, chains);
  const candidates = [memory, readStorage()].filter(Boolean) as HotCachePayload[];
  for (const c of candidates) {
    if (
      cacheKey(c.interval, c.limit, c.maxCreated || "7d", c.chains) === key
    ) {
      memory = c;
      return c;
    }
  }
  return null;
}

export function isHotCacheFresh(
  payloadOrTs: HotCachePayload | number,
  ttlMs = HOT_CACHE_TTL_MS
) {
  const ts =
    typeof payloadOrTs === "number" ? payloadOrTs : payloadOrTs.fetchedAt;
  return Date.now() - ts < ttlMs;
}

export function formatCacheAge(fetchedAt: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - fetchedAt) / 1000));
  if (sec < 10) return "刚刚";
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  return `${Math.floor(min / 60)} 小时前`;
}

export async function loadHotCached(opts: {
  interval?: string;
  limit?: number;
  maxCreated?: string;
  chains?: string[];
  /** skip cache, force network */
  force?: boolean;
  ttlMs?: number;
}): Promise<{
  payload: HotCachePayload;
  fromCache: boolean;
  revalidating: boolean;
}> {
  const interval = opts.interval || "24h";
  const limit = opts.limit ?? 20;
  const maxCreated = opts.maxCreated || "7d";
  const chains = opts.chains || [...ALL_CHAIN_IDS];
  const ttl = opts.ttlMs ?? HOT_CACHE_TTL_MS;
  const key = cacheKey(interval, limit, maxCreated, chains);

  const cached = peekHotCache({ interval, limit, maxCreated, chains });

  if (!opts.force && cached && isHotCacheFresh(cached, ttl)) {
    return { payload: cached, fromCache: true, revalidating: false };
  }

  if (!opts.force && cached) {
    void fetchAndStore(interval, limit, maxCreated, chains, key).catch(
      () => undefined
    );
    return { payload: cached, fromCache: true, revalidating: true };
  }

  const payload = await fetchAndStore(
    interval,
    limit,
    maxCreated,
    chains,
    key
  );
  return { payload, fromCache: false, revalidating: false };
}

async function fetchAndStore(
  interval: string,
  limit: number,
  maxCreated: string,
  chains: string[],
  key: string
): Promise<HotCachePayload> {
  if (inflight && inflightKey === key) {
    return inflight;
  }

  inflightKey = key;
  inflight = (async () => {
    const data = await getHot({
      chains,
      interval,
      limit,
      max_created: maxCreated,
    });
    const byChain: Record<string, Token[]> = {};
    const chainErrors: Record<string, string> = {};
    for (const c of chains) {
      const block: ChainBlock | undefined = data.by_chain?.[c];
      byChain[c] = block?.ok ? block.tokens || [] : [];
      if (block && !block.ok) chainErrors[c] = block.error || "failed";
    }
    const payload: HotCachePayload = {
      interval,
      limit,
      maxCreated,
      chains,
      byChain,
      chainErrors,
      fetchedAt: Date.now(),
    };
    writeStorage(payload);
    return payload;
  })();

  try {
    return await inflight;
  } finally {
    if (inflightKey === key) {
      inflight = null;
      inflightKey = "";
    }
  }
}

export function clearHotCache() {
  memory = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadHotUiPrefs(): Partial<UiPrefs> {
  try {
    const raw = sessionStorage.getItem(UI_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as UiPrefs;
  } catch {
    return {};
  }
}

export function saveHotUiPrefs(prefs: UiPrefs) {
  try {
    sessionStorage.setItem(UI_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
