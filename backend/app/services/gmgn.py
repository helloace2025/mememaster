"""GMGN data client.

Primary path: `gmgn-cli` (survives Cloudflare better than raw Python HTTP).
Fallback: OpenAPI exist-auth via httpx.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import time
import uuid
from typing import Any

import httpx

from app.config import Settings


class GmgnError(Exception):
    def __init__(self, message: str, status: int | None = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


class GmgnClient:
    def __init__(self, settings: Settings):
        self.base = settings.gmgn_openapi_base.rstrip("/")
        self.api_key = settings.gmgn_api_key
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
        async with httpx.AsyncClient(timeout=45.0) as client:
            res = await client.get(url, headers=self._headers(), params=query)
        return self._parse(res, path)

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
        # Prefer CLI — same auth stack as skills, fewer CF blocks
        if self.cli:
            try:
                return await self._trending_via_cli(
                    chain, interval, limit, order_by, max_created
                )
            except Exception as cli_err:
                # fall through to HTTP if key present
                if not self.api_key:
                    raise GmgnError(f"gmgn-cli failed: {cli_err}") from cli_err
                http_err: Exception | None = None
                try:
                    return await self._trending_via_http(
                        chain, interval, limit, order_by, max_created
                    )
                except Exception as e:
                    http_err = e
                raise GmgnError(f"cli failed ({cli_err}); http failed ({http_err})") from http_err

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
        cmd = [
            self.cli or "gmgn-cli",
            "market",
            "trending",
            "--chain",
            chain,
            "--interval",
            interval,
            "--limit",
            str(limit),
            "--order-by",
            order_by,
            "--raw",
        ]
        if max_created:
            cmd.extend(["--max-created", max_created])

        def run() -> str:
            import subprocess

            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=90,
                shell=False,
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
        return self._extract_rank(raw, chain, limit, max_created=max_created)

    async def _trending_via_http(
        self,
        chain: str,
        interval: str,
        limit: int,
        order_by: str,
        max_created: str | None = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "chain": chain,
            "interval": interval,
            "limit": limit,
            "order_by": order_by,
        }
        # openapi rank may accept max_created in query (same as CLI filter service)
        if max_created:
            params["max_created"] = max_created
        raw = await self.get("/v1/market/rank", params)
        return self._extract_rank(raw, chain, limit, max_created=max_created)

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

            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
                shell=False,
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

    def _extract_rank(
        self,
        raw: Any,
        chain: str,
        limit: int,
        max_created: str | None = None,
    ) -> list[dict[str, Any]]:
        data = raw.get("data", raw) if isinstance(raw, dict) else raw
        if isinstance(data, dict):
            rank = data.get("rank") or data.get("list") or []
        elif isinstance(data, list):
            rank = data
        else:
            rank = []
        max_age_sec = parse_duration_seconds(max_created) if max_created else None
        now = time.time()
        out: list[dict[str, Any]] = []
        for item in rank:
            if not isinstance(item, dict):
                continue
            item = dict(item)
            # client-side age filter as backup if upstream ignored max_created
            if max_age_sec is not None:
                created = item.get("creation_timestamp") or item.get("open_timestamp")
                try:
                    created_f = float(created) if created is not None else None
                except (TypeError, ValueError):
                    created_f = None
                if created_f and created_f > 1e12:  # ms
                    created_f = created_f / 1000.0
                if created_f and (now - created_f) > max_age_sec:
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
    """
    if raw is None:
        return "", "missing"
    s = str(raw).strip()
    if not s or s.lower() in ("null", "none", "undefined", "-", "n/a"):
        return "", "missing"
    if s.startswith("http"):
        s = s.rstrip("/").split("/")[-1]
        # x.com/i/user/123456 → numeric id path
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
    # Twitter/X handle: 1–15 letters/numbers/underscore
    import re as _re

    if not _re.fullmatch(r"[A-Za-z0-9_]{1,15}", s):
        # still allow slightly longer legacy, but reject obvious garbage
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
