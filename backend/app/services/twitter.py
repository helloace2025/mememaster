"""6551 OpenNews Twitter REST client — resilient fetches.

Uses the same HTTP endpoints as the opentwitter skill:
POST https://ai.6551.io/open/twitter_* with Authorization: Bearer OPENNEWS_TOKEN.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

from app.config import Settings

log = logging.getLogger("mememaster.twitter")


class TwitterError(Exception):
    def __init__(self, message: str, *, retryable: bool = False, status: int | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.status = status


def _clean_token(raw: str) -> str:
    t = (raw or "").strip()
    # Railway / docker sometimes wrap values in quotes
    if (t.startswith('"') and t.endswith('"')) or (t.startswith("'") and t.endswith("'")):
        t = t[1:-1].strip()
    if t.lower().startswith("bearer "):
        t = t[7:].strip()
    return t


class TwitterClient:
    def __init__(self, settings: Settings):
        self.base = (
            settings.opennews_api_base
            or os.environ.get("OPENNEWS_API_BASE")
            or "https://ai.6551.io"
        ).rstrip("/")
        self.token = _clean_token(
            settings.opennews_token or os.environ.get("OPENNEWS_TOKEN") or ""
        )
        if not self.token:
            raise TwitterError("OPENNEWS_TOKEN is not set")

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "mememaster/1.0",
        }

    async def post(
        self,
        path: str,
        body: dict[str, Any],
        *,
        retries: int = 2,
        timeout: float = 35.0,
    ) -> Any:
        """POST with retries. Tries default routing, then IPv4-bound transport."""
        url = f"{self.base}{path}"
        last_err: Exception | None = None
        # 0 = default (works on most hosts); 1 = force IPv4 (helps some IPv6-broken nets)
        transports: list[httpx.AsyncHTTPTransport | None] = [
            None,
            httpx.AsyncHTTPTransport(local_address="0.0.0.0"),
        ]

        for attempt in range(retries + 1):
            for transport in transports:
                try:
                    kwargs: dict[str, Any] = {
                        "timeout": httpx.Timeout(timeout, connect=12.0),
                        "follow_redirects": True,
                    }
                    if transport is not None:
                        kwargs["transport"] = transport
                    async with httpx.AsyncClient(**kwargs) as client:
                        res = await client.post(
                            url, headers=self._headers(), json=body
                        )
                    return self._parse_response(path, res)
                except TwitterError as e:
                    last_err = e
                    if e.retryable and attempt < retries:
                        await asyncio.sleep(0.6 * (attempt + 1))
                        break  # next attempt, same transport ladder
                    # non-retryable: don't try other transport for business errors
                    if e.status and e.status < 500 and e.status not in (408, 425, 429):
                        raise
                    continue
                except httpx.TimeoutException as e:
                    last_err = TwitterError(f"{path} timeout", retryable=True)
                    log.warning("twitter timeout %s attempt=%s", path, attempt + 1)
                    continue
                except httpx.HTTPError as e:
                    last_err = TwitterError(f"{path} network: {e}", retryable=True)
                    log.warning(
                        "twitter network %s transport=%s: %s",
                        path,
                        "ipv4" if transport else "default",
                        e,
                    )
                    continue
            else:
                continue
            # broke from inner due to retryable TwitterError
            continue

        raise last_err or TwitterError(f"{path} failed")

    def _parse_response(self, path: str, res: httpx.Response) -> Any:
        try:
            data = res.json()
        except Exception as e:
            raise TwitterError(
                f"non-JSON from {path}: {res.status_code}",
                retryable=res.status_code >= 500,
                status=res.status_code,
            ) from e

        # Top-level business failure
        if isinstance(data, dict) and data.get("success") is False:
            err = str(data.get("error") or data.get("message") or data)
            retryable = (
                "try again" in err.lower()
                or "rate" in err.lower()
                or "query failed" in err.lower()
            )
            raise TwitterError(
                f"{path}: {err}", retryable=retryable, status=res.status_code
            )

        if res.status_code >= 400:
            err_msg = (
                data
                if not isinstance(data, dict)
                else (data.get("error") or data.get("message") or data)
            )
            text = str(err_msg)
            retryable = (
                res.status_code in (408, 425, 429)
                or res.status_code >= 500
                or "try again" in text.lower()
                or "query failed" in text.lower()
            )
            raise TwitterError(
                f"{path} HTTP {res.status_code}: {text}",
                retryable=retryable,
                status=res.status_code,
            )

        return data

    async def user_info(self, username: str) -> dict[str, Any] | None:
        username = username.lstrip("@").strip()
        if not username:
            return None
        data = await self.post("/open/twitter_user_info", {"username": username})
        if isinstance(data, dict):
            inner = data.get("data") if isinstance(data.get("data"), dict) else data
            return inner  # type: ignore[return-value]
        return None

    async def user_tweets(
        self,
        username: str,
        max_results: int = 10,
        *,
        product: str = "Latest",
        include_replies: bool = False,
        include_retweets: bool = False,
    ) -> list[dict[str, Any]]:
        username = username.lstrip("@").strip()
        if not username:
            return []
        data = await self.post(
            "/open/twitter_user_tweets",
            {
                "username": username,
                "maxResults": max_results,
                "product": product,
                "includeReplies": include_replies,
                "includeRetweets": include_retweets,
            },
            retries=1,
        )
        return self._extract_tweet_list(data)

    async def search_from_user(
        self,
        username: str,
        max_results: int = 20,
        *,
        product: str = "Latest",
    ) -> list[dict[str, Any]]:
        username = username.lstrip("@").strip()
        if not username:
            return []
        data = await self.post(
            "/open/twitter_search",
            {
                "fromUser": username,
                "maxResults": max_results,
                "product": product,
            },
            retries=1,
        )
        items = self._extract_tweet_list(data)
        uname = username.lower()
        filtered: list[dict[str, Any]] = []
        for t in items:
            if not isinstance(t, dict):
                continue
            author = str(
                t.get("userScreenName")
                or t.get("screen_name")
                or t.get("username")
                or t.get("user_name")
                or ""
            ).lstrip("@").lower()
            # Keep if author missing or matches (case-insensitive)
            if author and author != uname:
                continue
            filtered.append(t)
        return filtered

    @staticmethod
    def _tweet_id(t: dict[str, Any]) -> str:
        for k in ("id", "id_str", "tweetId", "tweet_id", "twId"):
            v = t.get(k)
            if v is not None and str(v).strip():
                return str(v).strip()
        text = str(t.get("text") or t.get("full_text") or t.get("content") or "")[:120]
        tm = str(t.get("createdAt") or t.get("created_at") or t.get("time") or "")
        return f"{tm}|{text}"

    @classmethod
    def _merge_tweets(
        cls,
        *batches: list[dict[str, Any]],
        limit: int = 25,
    ) -> list[dict[str, Any]]:
        seen: set[str] = set()
        out: list[dict[str, Any]] = []
        for batch in batches:
            for t in batch:
                if not isinstance(t, dict):
                    continue
                tid = cls._tweet_id(t)
                if tid in seen:
                    continue
                seen.add(tid)
                out.append(t)
                if len(out) >= limit:
                    return out
        return out

    async def user_tweets_resilient(
        self,
        username: str,
        max_results: int = 20,
    ) -> tuple[list[dict[str, Any]], list[str]]:
        """
        Fast path: search fromUser first (full timeline).
        Fallback: one user_tweets call.
        """
        username = username.lstrip("@").strip()
        notes: list[str] = []
        collected: list[dict[str, Any]] = []
        target = max(5, min(max_results, 20))

        for product in ("Latest", "Top"):
            try:
                searched = await self.search_from_user(
                    username, max_results=max_results, product=product
                )
                if searched:
                    before = len(collected)
                    collected = self._merge_tweets(
                        collected, searched, limit=max_results
                    )
                    notes.append(
                        f"search/{product} +{len(collected) - before} total={len(collected)}"
                    )
                    if len(collected) >= target:
                        break
                else:
                    notes.append(f"search/{product} empty")
            except TwitterError as e:
                notes.append(f"search/{product} fail")
                log.warning("search_from_user @%s %s: %s", username, product, e)

        if len(collected) < target:
            try:
                tweets = await self.user_tweets(
                    username,
                    max_results=max_results,
                    product="Latest",
                    include_replies=True,
                    include_retweets=True,
                )
                if tweets:
                    before = len(collected)
                    collected = self._merge_tweets(
                        collected, tweets, limit=max_results
                    )
                    notes.append(
                        f"user_tweets +{len(collected) - before} total={len(collected)}"
                    )
            except TwitterError as e:
                notes.append("user_tweets fail")
                log.warning("user_tweets @%s: %s", username, e)

        log.info(
            "twitter resilient @%s count=%s notes=%s",
            username,
            len(collected),
            " | ".join(notes[:6]),
        )
        return collected[:max_results], notes

    @staticmethod
    def _extract_tweet_list(data: Any) -> list[dict[str, Any]]:
        """Best-effort unwrap of 6551 / OpenNews tweet payloads."""
        if isinstance(data, list):
            return [x for x in data if isinstance(x, dict)]
        if not isinstance(data, dict):
            return []

        for key in ("data", "tweets", "items", "list", "result", "results"):
            val = data.get(key)
            if isinstance(val, list):
                return [x for x in val if isinstance(x, dict)]
            if isinstance(val, dict):
                for k2 in ("items", "tweets", "list", "data", "entries"):
                    if isinstance(val.get(k2), list):
                        return [x for x in val[k2] if isinstance(x, dict)]
                inner = val.get("data")
                if isinstance(inner, list):
                    return [x for x in inner if isinstance(x, dict)]
                if isinstance(inner, dict):
                    for k3 in ("items", "tweets", "list"):
                        if isinstance(inner.get(k3), list):
                            return [x for x in inner[k3] if isinstance(x, dict)]

        for v in data.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                if any(k in v[0] for k in ("text", "full_text", "content", "id")):
                    return [x for x in v if isinstance(x, dict)]
        return []


async def probe_opennews(settings: Settings, username: str = "elonmusk") -> dict[str, Any]:
    """Connectivity check for health/debug — no LLM."""
    out: dict[str, Any] = {
        "token_configured": bool(
            _clean_token(settings.opennews_token or os.environ.get("OPENNEWS_TOKEN") or "")
        ),
        "base": (settings.opennews_api_base or "https://ai.6551.io").rstrip("/"),
        "username": username.lstrip("@").strip(),
    }
    if not out["token_configured"]:
        out["ok"] = False
        out["error"] = "OPENNEWS_TOKEN not set"
        return out
    try:
        tw = TwitterClient(settings)
        tweets, notes = await tw.user_tweets_resilient(out["username"], max_results=5)
        out["ok"] = len(tweets) > 0
        out["tweet_count"] = len(tweets)
        out["sample"] = [
            {
                "text": str(t.get("text") or t.get("full_text") or "")[:120],
                "time": str(t.get("createdAt") or t.get("created_at") or ""),
            }
            for t in tweets[:3]
            if isinstance(t, dict)
        ]
        out["notes"] = notes[:4]
        if not tweets:
            out["error"] = "API reachable but returned 0 tweets"
    except Exception as e:
        out["ok"] = False
        out["error"] = str(e)[:300]
        log.warning("probe_opennews failed: %s", e)
    return out
