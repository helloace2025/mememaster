"""GMGN data client.

Primary path: `gmgn-cli` (forces IPv4 + same auth stack as skills).
Fallback: OpenAPI exist-auth via httpx (also IPv4-bound).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import time
import uuid
from typing import Any

import httpx

from app.config import Settings

log = logging.getLogger("mememaster.gmgn")


class GmgnError(Exception):
    def __init__(self, message: str, status: int | None = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


def _ipv4_transport() -> httpx.AsyncHTTPTransport:
    """Bind local side to 0.0.0.0 so connections use IPv4.

    gmgn-cli does the same (undici family: 4). IPv6 to openapi.gmgn.ai
    often fails or returns empty/blocked payloads on cloud hosts.
    """
    return httpx.AsyncHTTPTransport(local_address="0.0.0.0")


class GmgnClient:
    def __init__(self, settings: Settings):
        self.base = settings.gmgn_openapi_base.rstrip("/")
        self.api_key = (settings.gmgn_api_key or os.environ.get("GMGN_API_KEY") or "").strip()
        self.cli = shutil.which("gmgn-cli")
        if not self.api_key and not self.cli:
            raise GmgnError("GMGN_API_KEY is not set and gmgn-cli not found")

    def _headers(self) -> dict[str, str]:
        return {
            "X-APIKEY": self.api_key,
            "Content-Type": "application/json",
            "User-Agent": "gmgn-cli/1.5.2",
            "Accept": "application/json",
        }

    def _auth_params(self, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {
            "timestamp": int(time.time()),
            "client_id": str(uuid.uuid4()),
        }
        if extra:
            params.update(extra)
        return params

    async def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        if not self.api_key:
            raise GmgnError("GMGN_API_KEY is not set")
        url = f"{self.base}{path}"
        query = self._auth_params(params)
        # Fresh timestamp/client_id per attempt; retry once on transient empty/CF
        last_err: Exception | None = None
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(45.0, connect=20.0),
                    transport=_ipv4_transport(),
                    follow_redirects=True,
                ) as client:
                    res = await client.get(url, headers=self._headers(), params=query)
                return self._parse(res, path)
            except (httpx.TransportError, httpx.TimeoutException) as e:
                last_err = e
                log.warning("GMGN %s transport error attempt=%s: %s", path, attempt + 1, e)
                # rebuild auth params for retry (timestamp window is ±5s)
                query = self._auth_params(params)
                await asyncio.sleep(0.4)
        raise GmgnError(f"GMGN {path} network failed: {last_err}") from last_err

    def _parse(self, res: httpx.Response, path: str) -> Any:
        try:
            data = res.json()
        except Exception:
            raise GmgnError(
                f"GMGN {path} non-JSON response: {res.status_code}",
                res.status_code,
                res.text[:500],
            )

        if res.status_code >= 400:
            raise GmgnError(
                f"GMGN {path} HTTP {res.status_code}: {data}",
                res.status_code,
                data,
            )

        if isinstance(data, dict) and "code" in data and data.get("code") not in (0, "0", None):
            raise GmgnError(f"GMGN {path} code={data.get('code')}: {data}", res.status_code, data)
        return data

    async def trending(
        self,
        chain: str,
        interval: str = "24h",
        limit: int = 20,
        order_by: str = "volume",
        max_created: str | None = None,
    ) -> list[dict[str, Any]]:
        """Fetch trending rank.

        max_created: only tokens younger than this, e.g. ``7d`` / ``24h`` / ``3d``.
        Filters old bluechips out so the board surfaces new narratives.
        """
        chain = (chain or "sol").strip().lower()
        # Prefer CLI — IPv4 + same stack as skills
        if self.cli:
            try:
                out = await self._trending_via_cli(
                    chain, interval, limit, order_by, max_created
                )
                if out:
                    return out
                log.warning(
                    "gmgn-cli rank empty chain=%s interval=%s max_created=%s — trying HTTP",
                    chain,
                    interval,
                    max_created,
                )
            except Exception as cli_err:
                log.warning("gmgn-cli trending failed: %s", cli_err)
                if not self.api_key:
                    raise GmgnError(f"gmgn-cli failed: {cli_err}") from cli_err
                try:
                    return await self._trending_via_http(
                        chain, interval, limit, order_by, max_created
                    )
                except Exception as http_err:
                    raise GmgnError(
                        f"cli failed ({cli_err}); http failed ({http_err})"
                    ) from http_err

        return await self._trending_via_http(
            chain, interval, limit, order_by, max_created
        )

    async def _trending_via_cli(
        self,
        chain: str,
        interval: str,
        limit: int,
        order_by: str,
        max_created: str | None = None,
    ) -> list[dict[str, Any]]:
        # Over-fetch when age-filtering client-side is a backup for CLI server filter
        fetch_limit = min(100, max(limit, limit * 3 if max_created else limit))
        cmd = [
            self.cli or "gmgn-cli",
            "market",
            "trending",
            "--chain",
            chain,
            "--interval",
            interval,
            "--limit",
            str(fetch_limit),
            "--order-by",
            order_by,
            "--raw",
        ]
        if max_created:
            cmd.extend(["--max-created", max_created])

        def run() -> str:
            import subprocess

            env = os.environ.copy()
            if self.api_key:
                env["GMGN_API_KEY"] = self.api_key
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=90,
                shell=False,
                env=env,
            )
            if proc.returncode != 0:
                raise GmgnError(
                    f"gmgn-cli exit {proc.returncode}: {(proc.stderr or proc.stdout)[:500]}"
                )
            return (proc.stdout or "").strip()

        out = await asyncio.to_thread(run)
        if not out:
            raise GmgnError("gmgn-cli returned empty output")
        # CLI may print non-json lines; take last JSON-looking line
        line = out.splitlines()[-1]
        raw = json.loads(line)
        items = self._extract_rank(raw, chain, limit, max_created=max_created)
        # If server ignored max_created and client filter wiped the list, retry without age filter
        if not items and max_created:
            raw_n = self._rank_len(raw)
            if raw_n > 0:
                log.warning(
                    "cli rank filtered to 0 (raw=%s) chain=%s max_created=%s — relaxing age filter",
                    raw_n,
                    chain,
                    max_created,
                )
                items = self._extract_rank(raw, chain, limit, max_created=None)
        return items

    async def _trending_via_http(
        self,
        chain: str,
        interval: str,
        limit: int,
        order_by: str,
        max_created: str | None = None,
    ) -> list[dict[str, Any]]:
        # Over-fetch so client-side age filter still yields `limit` rows
        fetch_limit = min(100, max(limit * 5, 50) if max_created else limit)

        async def _once(
            *,
            use_max: bool,
            use_order: bool,
            lim: int,
        ) -> list[dict[str, Any]]:
            params: dict[str, Any] = {
                "chain": chain,
                "interval": interval,
                "limit": lim,
            }
            if use_order and order_by:
                params["order_by"] = order_by
            # openapi-service evaluates max_created itself (m/h/d duration strings)
            if use_max and max_created:
                params["max_created"] = max_created
            raw = await self.get("/v1/market/rank", params)
            raw_n = self._rank_len(raw)
            items = self._extract_rank(
                raw,
                chain,
                limit,
                # if upstream already applied max_created, still re-apply as safety net
                max_created=max_created if use_max else None,
            )
            if not items and raw_n > 0 and max_created:
                # upstream ignored max_created; client filter wiped bluechips → relax
                items = self._extract_rank(raw, chain, limit, max_created=None)
            if not items:
                log.warning(
                    "HTTP rank empty chain=%s raw_n=%s keys=%s params=%s",
                    chain,
                    raw_n,
                    list(raw.keys()) if isinstance(raw, dict) else type(raw).__name__,
                    {k: v for k, v in params.items() if k not in ("timestamp", "client_id")},
                )
            return items

        # Attempt ladder: normal → no age → no order_by → bare minimum
        attempts = [
            {"use_max": True, "use_order": True, "lim": fetch_limit},
            {"use_max": False, "use_order": True, "lim": fetch_limit},
            {"use_max": False, "use_order": False, "lim": min(100, fetch_limit)},
        ]
        last: list[dict[str, Any]] = []
        for kwargs in attempts:
            # skip max-created attempts when none requested
            if kwargs["use_max"] and not max_created:
                continue
            try:
                last = await _once(**kwargs)
            except Exception as e:
                log.warning("HTTP rank attempt failed %s: %s", kwargs, e)
                continue
            if last:
                return last
            # brief pause between attempts (rate-limit / auth clock)
            await asyncio.sleep(0.35)
        return last

    async def token_info(self, chain: str, address: str) -> dict[str, Any]:
        """Fetch single token metadata + realtime price (GMGN token info)."""
        address = (address or "").strip()
        chain = (chain or "sol").strip().lower()
        if not address:
            raise GmgnError("address is required")
        if self.cli:
            try:
                return await self._token_info_via_cli(chain, address)
            except Exception as cli_err:
                if not self.api_key:
                    raise GmgnError(f"gmgn-cli token info failed: {cli_err}") from cli_err
                try:
                    return await self._token_info_via_http(chain, address)
                except Exception as http_err:
                    raise GmgnError(
                        f"cli failed ({cli_err}); http failed ({http_err})"
                    ) from http_err
        return await self._token_info_via_http(chain, address)

    async def _token_info_via_cli(self, chain: str, address: str) -> dict[str, Any]:
        cmd = [
            self.cli or "gmgn-cli",
            "token",
            "info",
            "--chain",
            chain,
            "--address",
            address,
            "--raw",
        ]

        def run() -> str:
            import subprocess

            env = os.environ.copy()
            if self.api_key:
                env["GMGN_API_KEY"] = self.api_key
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
                shell=False,
                env=env,
            )
            if proc.returncode != 0:
                raise GmgnError(
                    f"gmgn-cli token info exit {proc.returncode}: "
                    f"{(proc.stderr or proc.stdout)[:500]}"
                )
            return (proc.stdout or "").strip()

        out = await asyncio.to_thread(run)
        if not out:
            raise GmgnError("gmgn-cli token info empty")
        line = out.splitlines()[-1]
        raw = json.loads(line)
        return flatten_token_info(raw, chain, address)

    async def _token_info_via_http(self, chain: str, address: str) -> dict[str, Any]:
        # OpenAPI path used by gmgn-cli token info
        raw = await self.get(
            "/v1/token/info",
            {"chain": chain, "address": address},
        )
        return flatten_token_info(raw, chain, address)

    @staticmethod
    def _rank_list(raw: Any) -> list[Any]:
        """Pull rank array from heterogeneous OpenAPI envelopes."""
        if raw is None:
            return []
        if isinstance(raw, list):
            return raw
        if not isinstance(raw, dict):
            return []
        data = raw.get("data", raw)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in ("rank", "list", "tokens", "items", "rows"):
                v = data.get(key)
                if isinstance(v, list):
                    return v
            # some payloads nest once more
            inner = data.get("data")
            if isinstance(inner, list):
                return inner
            if isinstance(inner, dict):
                for key in ("rank", "list", "tokens"):
                    v = inner.get(key)
                    if isinstance(v, list):
                        return v
        # top-level fallbacks
        for key in ("rank", "list", "tokens"):
            v = raw.get(key)
            if isinstance(v, list):
                return v
        return []

    def _rank_len(self, raw: Any) -> int:
        return len(self._rank_list(raw))

    def _extract_rank(
        self,
        raw: Any,
        chain: str,
        limit: int,
        max_created: str | None = None,
    ) -> list[dict[str, Any]]:
        rank = self._rank_list(raw)
        max_age_sec = parse_duration_seconds(max_created) if max_created else None
        now = time.time()
        out: list[dict[str, Any]] = []
        for item in rank:
            if not isinstance(item, dict):
                continue
            item = dict(item)
            # client-side age filter as backup if upstream ignored max_created
            if max_age_sec is not None:
                created = (
                    item.get("creation_timestamp")
                    or item.get("open_timestamp")
                    or item.get("created_timestamp")
                )
                try:
                    created_f = float(created) if created is not None else None
                except (TypeError, ValueError):
                    created_f = None
                if created_f is not None and created_f > 1e12:  # ms
                    created_f = created_f / 1000.0
                # Missing timestamp: keep row (don't discard whole board)
                if created_f is not None and created_f > 0 and (now - created_f) > max_age_sec:
                    continue
            item.setdefault("chain", chain)
            item["rank"] = len(out) + 1
            out.append(item)
            if len(out) >= limit:
                break
        return out


def parse_duration_seconds(s: str | None) -> float | None:
    """Parse ``30m`` / ``6h`` / ``7d`` into seconds."""
    if not s:
        return None
    s = str(s).strip().lower()
    import re

    m = re.fullmatch(r"(\d+(?:\.\d+)?)([mhd])", s)
    if not m:
        return None
    n = float(m.group(1))
    unit = m.group(2)
    if unit == "m":
        return n * 60
    if unit == "h":
        return n * 3600
    if unit == "d":
        return n * 86400
    return None


def clean_twitter_username(raw: Any) -> tuple[str, str]:
    """Return (username, status).

    status:
      - ok: usable @handle
      - missing: no twitter linked
      - dead: deleted / numeric snowflake / garbage — no research value
      - community: X Community link only (no personal handle)
    """
    import re as _re

    if raw is None:
        return "", "missing"
    s = str(raw).strip()
    if not s or s.lower() in ("null", "none", "undefined", "-", "n/a"):
        return "", "missing"

    # Full URL forms from GMGN rank items
    #   https://x.com/foo
    #   https://x.com/foo/status/123
    #   https://twitter.com/i/user/123
    #   https://x.com/i/communities/123
    if "://" in s or s.lower().startswith(("x.com/", "twitter.com/", "www.")):
        low = s.lower()
        if "/i/communities/" in low or "/communities/" in low:
            return "", "community"
        if "/i/user/" in low or "/i/lists/" in low:
            return "", "dead"
        # /status/ID → take handle before /status/
        m = _re.search(
            r"(?:x\.com|twitter\.com)/@?([A-Za-z0-9_]{1,20})(?:/status/|/i/|/with_replies|/media|/likes)?",
            s,
            _re.I,
        )
        if m:
            handle = m.group(1)
            if handle.lower() in ("i", "intent", "share", "search", "home", "explore", "settings"):
                return "", "dead"
            s = handle
        else:
            # fallback: last path segment
            path = s.split("?", 1)[0].rstrip("/")
            s = path.split("/")[-1]
            if s.isdigit():
                return "", "dead"

    s = s.lstrip("@").strip()
    if not s:
        return "", "missing"
    # pure numeric / snowflake user-id (common after account delete / bad scrape)
    if s.isdigit():
        return "", "dead"
    # mostly digits with junk (e.g. 1234567890_deleted)
    digits = sum(ch.isdigit() for ch in s)
    if len(s) >= 10 and digits / max(len(s), 1) >= 0.85:
        return "", "dead"
    # Twitter/X handle: 1–15 letters/numbers/underscore (allow up to 20 legacy)
    if not _re.fullmatch(r"[A-Za-z0-9_]{1,20}", s):
        if len(s) > 20 or _re.search(r"[^\w]", s):
            return "", "dead"
    return s, "ok"


def flatten_token_info(raw: Any, chain: str, address: str) -> dict[str, Any]:
    """Normalize GMGN token info (CLI/HTTP) into the same shape as rank cards."""
    data = raw.get("data", raw) if isinstance(raw, dict) else raw
    if not isinstance(data, dict):
        data = {}
    price = data.get("price") if isinstance(data.get("price"), dict) else {}
    pool = data.get("pool") if isinstance(data.get("pool"), dict) else {}
    link = data.get("link") if isinstance(data.get("link"), dict) else {}
    stat = data.get("stat") if isinstance(data.get("stat"), dict) else {}
    wtags = (
        data.get("wallet_tags_stat")
        if isinstance(data.get("wallet_tags_stat"), dict)
        else {}
    )
    dev = data.get("dev") if isinstance(data.get("dev"), dict) else {}

    addr = (
        data.get("address")
        or link.get("address")
        or address
        or ""
    )
    # price payload sometimes nests address
    if not addr and isinstance(price, dict):
        addr = price.get("address") or addr

    def fnum(*keys: str, src: dict[str, Any] | None = None) -> float | None:
        d = src if src is not None else data
        for k in keys:
            v = d.get(k) if d else None
            if v is None or v == "":
                continue
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
        return None

    # merge flat fields for normalize_token
    flat: dict[str, Any] = {
        **data,
        "address": addr or address,
        "symbol": data.get("symbol") or "",
        "name": data.get("name") or data.get("symbol") or (addr or address)[:8],
        "logo": data.get("logo") or "",
        "price": fnum("price", src=price) if price else fnum("price"),
        "market_cap": fnum("market_cap", "usd_market_cap")
        or (
            # estimate from price * circulating if present
            None
        ),
        "liquidity": fnum("liquidity") or fnum("liquidity", src=pool),
        "volume": fnum("volume_24h", "volume", src=price) or fnum("volume_24h", "volume"),
        "price_change_percent": None,
        "holder_count": data.get("holder_count") or stat.get("holder_count"),
        "smart_degen_count": wtags.get("smart_wallets") or 0,
        "renowned_count": wtags.get("renowned_wallets") or 0,
        "twitter_username": link.get("twitter_username") or data.get("twitter_username"),
        "website": link.get("website") or data.get("website") or "",
        "telegram": link.get("telegram") or data.get("telegram") or "",
        "launchpad_platform": data.get("launchpad_platform")
        or data.get("launchpad")
        or pool.get("exchange")
        or "",
        "creation_timestamp": data.get("creation_timestamp")
        or data.get("open_timestamp")
        or pool.get("creation_timestamp"),
        "open_timestamp": data.get("open_timestamp") or data.get("creation_timestamp"),
        "top_10_holder_rate": fnum("top_10_holder_rate", src=stat)
        or fnum("top_10_holder_rate", src=dev),
        "creator_token_status": dev.get("creator_token_status"),
        "swaps": price.get("swaps_24h") if price else None,
        "buys": price.get("buys_24h") if price else None,
        "sells": price.get("sells_24h") if price else None,
        "hot_level": price.get("hot_level") if price else None,
    }

    # 24h change from price_* fields if available
    try:
        p0 = float(price.get("price") or 0) if price else 0
        p24 = float(price.get("price_24h") or 0) if price else 0
        if p0 > 0 and p24 > 0:
            flat["price_change_percent"] = (p0 - p24) / p24 * 100.0
    except (TypeError, ValueError):
        pass

    # rough mcap: price * circulating_supply
    if flat.get("market_cap") is None:
        try:
            px = float(flat.get("price") or 0)
            circ = float(data.get("circulating_supply") or data.get("total_supply") or 0)
            if px > 0 and circ > 0:
                flat["market_cap"] = px * circ
        except (TypeError, ValueError):
            pass

    if not flat.get("volume"):
        try:
            flat["volume"] = float(price.get("volume_24h") or 0) if price else None
        except (TypeError, ValueError):
            flat["volume"] = None

    return normalize_token(flat, chain)


def normalize_token(item: dict[str, Any], chain: str) -> dict[str, Any]:
    """Flatten a rank item into a UI-friendly card."""
    address = item.get("address") or item.get("token_address") or ""
    symbol = item.get("symbol") or "?"
    name = item.get("name") or symbol
    raw_tw = item.get("twitter_username") or item.get("twitter") or ""
    twitter, tw_status = clean_twitter_username(raw_tw)

    def fnum(key: str, default: float | None = None) -> float | None:
        v = item.get(key)
        if v is None or v == "":
            return default
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    return {
        "chain": chain,
        "address": address,
        "symbol": symbol,
        "name": name,
        "logo": item.get("logo") or "",
        "price": fnum("price"),
        "market_cap": fnum("market_cap") or fnum("usd_market_cap"),
        "liquidity": fnum("liquidity"),
        "volume": fnum("volume") or fnum("volume_24h"),
        "price_change_percent": fnum("price_change_percent"),
        "price_change_percent1h": fnum("price_change_percent1h")
        or fnum("price_change_percent_1h"),
        "price_change_percent5m": fnum("price_change_percent5m"),
        "holder_count": item.get("holder_count"),
        "swaps": item.get("swaps") or item.get("buys") or item.get("txns"),
        "buys": item.get("buys"),
        "sells": item.get("sells"),
        "hot_level": item.get("hot_level"),
        "rank": item.get("rank"),
        "smart_degen_count": item.get("smart_degen_count") or 0,
        "renowned_count": item.get("renowned_count") or 0,
        "rug_ratio": fnum("rug_ratio"),
        "top_10_holder_rate": fnum("top_10_holder_rate"),
        "is_wash_trading": item.get("is_wash_trading"),
        "is_honeypot": item.get("is_honeypot"),
        "creator_token_status": item.get("creator_token_status"),
        "launchpad_platform": item.get("launchpad_platform") or item.get("exchange") or "",
        "twitter_username": twitter,
        "twitter_status": tw_status,
        "twitter_raw": str(raw_tw)[:80] if raw_tw else "",
        "website": item.get("website") or "",
        "telegram": item.get("telegram") or "",
        "open_timestamp": item.get("open_timestamp") or item.get("creation_timestamp"),
        "creation_timestamp": item.get("creation_timestamp") or item.get("open_timestamp"),
        "age_hours": _age_hours(
            item.get("creation_timestamp") or item.get("open_timestamp")
        ),
        # no research value when social is a dead numeric id and no real handle
        "skip_research": tw_status == "dead",
        "raw": item,
    }


def _age_hours(ts: Any) -> float | None:
    if ts is None or ts == "":
        return None
    try:
        t = float(ts)
    except (TypeError, ValueError):
        return None
    if t > 1e12:
        t = t / 1000.0
    import time as _time

    return max(0.0, (_time.time() - t) / 3600.0)
