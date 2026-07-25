"""6551 OpenNews Twitter REST client — resilient fetches.

Uses the same HTTP endpoints documented by the opentwitter skill
(POST https://ai.6551.io/open/twitter_*), with OPENNEWS_TOKEN Bearer auth.
No MCP/skill runtime is required inside the Railway container.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.config import Settings

log = logging.getLogger("mememaster.twitter")


class TwitterError(Exception):
    def __init__(self, message: str, *, retryable: bool = False, status: int | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.status = status


def _ipv4_transport() -> httpx.AsyncHTTPTransport:
    # Match gmgn path: force IPv4 on cloud hosts where IPv6 is flaky
    return httpx.AsyncHTTPTransport(local_address="0.0.0.0")


class TwitterClient:
    def __init__(self, settings: Settings):
        self.base = settings.opennews_api_base.rstrip("/")
        self.token = settings.opennews_token
        if not self.token:
            raise TwitterError("OPENNEWS_TOKEN is not set")

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "mememaster/1.0 (opentwitter-compat)",
        }

    async def post(
        self,
        path: str,
        body: dict[str, Any],
        *,
        retries: int = 2,
        timeout: float = 45.0,
    ) -> Any:
        """POST with light retries on 429 / 5xx / flaky 400 query-failed."""
        url = f"{self.base}{path}"
        last_err: Exception | None = None

        for attempt in range(retries + 1):
            try:
                async with httpx.AsyncClient(
                    # Keep short so Railway proxy / Next rewrite does not 500 first
                    timeout=httpx.Timeout(min(timeout, 28.0), connect=10.0),
                    transport=_ipv4_transport(),
                    follow_redirects=True,
                ) as client:
                    res = await client.post(url, headers=self._headers(), json=body)

                try:
                    data = res.json()
                except Exception as e:
                    raise TwitterError(
                        f"non-JSON from {path}: {res.status_code}",
                        retryable=res.status_code >= 500,
                        status=res.status_code,
                    ) from e

                # business-level failure sometimes returns HTTP 200 with success:false
                if isinstance(data, dict) and data.get("success") is False:
                    err = str(data.get("error") or data.get("message") or data)
                    retryable = "try again" in err.lower() or "rate" in err.lower()
                    if retryable and attempt < retries:
                        await asyncio.sleep(0.8 * (attempt + 1))
                        last_err = TwitterError(f"{path}: {err}", retryable=True, status=res.status_code)
                        continue
                    raise TwitterError(f"{path}: {err}", retryable=retryable, status=res.status_code)

                if res.status_code >= 400:
                    err_msg = data if not isinstance(data, dict) else (
                        data.get("error") or data.get("message") or data
                    )
                    text = str(err_msg)
                    retryable = (
                        res.status_code in (408, 425, 429)
                        or res.status_code >= 500
                        or "try again" in text.lower()
                        or "query failed" in text.lower()
                    )
                    if retryable and attempt < retries:
                        await asyncio.sleep(0.8 * (attempt + 1))
                        last_err = TwitterError(
                            f"{path} HTTP {res.status_code}: {text}",
                            retryable=True,
                            status=res.status_code,
                        )
                        continue
                    raise TwitterError(
                        f"{path} HTTP {res.status_code}: {text}",
                        retryable=retryable,
                        status=res.status_code,
                    )

                return data
            except TwitterError:
                raise
            except httpx.TimeoutException as e:
                last_err = TwitterError(f"{path} timeout", retryable=True)
                if attempt < retries:
                    await asyncio.sleep(0.8 * (attempt + 1))
                    continue
                raise last_err from e
            except httpx.HTTPError as e:
                last_err = TwitterError(f"{path} network: {e}", retryable=True)
                if attempt < retries:
                    await asyncio.sleep(0.8 * (attempt + 1))
                    continue
                raise last_err from e

        raise last_err or TwitterError(f"{path} failed")

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
        """twitter_search fromUser — often richer than twitter_user_tweets.

        6551's /open/twitter_user_tweets frequently returns only 1 (pinned/featured)
        post for brand accounts, while search returns a real timeline.
        """
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
        # keep only posts authored by this handle (search can occasionally mix)
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
            # if author missing, keep (upstream sometimes omits field)
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
        # fallback: text+time fingerprint
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
        Multi-strategy fetch for ops analysis — optimized for speed + yield.

        6551 quirk: ``twitter_user_tweets`` often returns only 1 post.
        ``twitter_search`` + ``fromUser`` usually returns a full page.

        Order (fast path first):
        1. search Latest / Top
        2. one user_tweets Latest pass if still thin
        """
        username = username.lstrip("@").strip()
        notes: list[str] = []
        collected: list[dict[str, Any]] = []
        target = max(5, min(max_results, 20))

        # 1) Primary: search fromUser (usually full timeline)
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
                        f"search product={product} raw={len(searched)} "
                        f"merged={len(collected)} (+{len(collected) - before})"
                    )
                    if len(collected) >= target:
                        break
                else:
                    notes.append(f"search product={product} empty")
            except TwitterError as e:
                notes.append(f"search product={product} fail")
                log.warning("search_from_user %s %s: %s", username, product, e)

        # 2) Fallback: single user_tweets call (avoid 4× sequential rounds)
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
                        f"user_tweets Latest raw={len(tweets)} "
                        f"merged={len(collected)} (+{len(collected) - before})"
                    )
            except TwitterError as e:
                notes.append("user_tweets fail")
                log.warning("user_tweets %s: %s", username, e)

        if notes:
            log.info(
                "user_tweets_resilient @%s n=%s notes=%s",
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
