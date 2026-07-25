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

log = logging.getLogger(__name__)


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
                    timeout=httpx.Timeout(timeout, connect=15.0),
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

    async def user_tweets_resilient(
        self,
        username: str,
        max_results: int = 20,
    ) -> tuple[list[dict[str, Any]], list[str]]:
        """
        Try multiple strategies. Observed: product=Latest often 400s on brand-new
        meme accounts while product=Top still works.
        Returns (tweets, notes).
        """
        username = username.lstrip("@").strip()
        notes: list[str] = []
        strategies: list[dict[str, Any]] = [
            {"product": "Latest", "includeReplies": False, "includeRetweets": False},
            {"product": "Top", "includeReplies": False, "includeRetweets": False},
            {"product": "Latest", "includeReplies": True, "includeRetweets": True},
            {"product": "Top", "includeReplies": True, "includeRetweets": True},
        ]

        for s in strategies:
            try:
                tweets = await self.user_tweets(
                    username,
                    max_results=max_results,
                    product=s["product"],
                    include_replies=s["includeReplies"],
                    include_retweets=s["includeRetweets"],
                )
                if tweets:
                    if s["product"] != "Latest" or s["includeReplies"]:
                        notes.append(
                            f"使用备用策略 product={s['product']}"
                            f" replies={s['includeReplies']} 拉到 {len(tweets)} 条"
                        )
                    return tweets, notes
                notes.append(f"product={s['product']} 返回空列表")
            except TwitterError as e:
                notes.append(f"product={s['product']} 失败: {e}")
                log.warning("user_tweets %s %s failed: %s", username, s["product"], e)
                continue

        # last resort: search from user
        try:
            data = await self.post(
                "/open/twitter_search",
                {
                    "fromUser": username,
                    "maxResults": max_results,
                    "product": "Latest",
                },
                retries=1,
            )
            tweets = self._extract_tweet_list(data)
            if tweets:
                notes.append(f"降级 twitter_search fromUser 拉到 {len(tweets)} 条")
                return tweets, notes
            notes.append("twitter_search fromUser 为空")
        except TwitterError as e:
            notes.append(f"twitter_search 失败: {e}")

        return [], notes

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
