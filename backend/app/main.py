from __future__ import annotations

import asyncio
import re
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.config import get_settings
from app.services.analyze import analyze_token
from app.services.chat import (
    analyze_twitter_ops,
    freeform_chat,
    generate_playbook,
    _twitter_fetch_failed_message,
)
from app.services.gmgn import GmgnClient, GmgnError, normalize_token
from app.services.llm import provider_status, resolve_llm
from app.services.twitter import TwitterClient, TwitterError
from app.services.website import analyze_website

settings = get_settings()

app = FastAPI(
    title="MemeMaster API",
    description="热门代币面板 + 叙事/立项分析（研究教育用途，非投资建议）",
    version="0.1.0",
)

# Railway / multi-origin: CORS_ORIGINS=* or comma list of frontend URLs
_cors_all = settings.cors_allow_all
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _cors_all else settings.origin_list,
    allow_credentials=not _cors_all,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeBody(BaseModel):
    chain: str
    address: str
    token: dict[str, Any] | None = None
    include_twitter: bool = True
    provider: str | None = Field(
        default=None,
        description="可选覆盖 LLM 厂商: deepseek|openai|google|anthropic|...",
    )
    model: str | None = Field(
        default=None,
        description="可选覆盖模型 ID，如 deepseek-v4-pro / gpt-4o",
    )
    api_key: str | None = Field(default=None, description="浏览器侧填写的 API Key（优先于 .env）")
    base_url: str | None = Field(default=None, description="自定义 Base URL（兼容网关 / Ollama）")


class AnalyzeBatchBody(BaseModel):
    tokens: list[dict[str, Any]] = Field(default_factory=list)
    include_twitter: bool = True
    max_tokens: int = 9
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None


class ChatBody(BaseModel):
    message: str
    history: list[dict[str, str]] = Field(default_factory=list)
    context: dict[str, Any] | None = None
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None


class TwitterOpsBody(BaseModel):
    username: str | None = None
    token: dict[str, Any] | None = None
    question: str = "分析这个账号的推文，看它是怎么运营的"
    max_tweets: int = 25
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None


class PlaybookBody(BaseModel):
    token: dict[str, Any] | None = None
    analysis: dict[str, Any] | None = None
    twitter_ops: str | None = None
    website_ops: str | None = None
    scores: list[dict[str, Any]] | None = None
    note: str | None = None
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None


class WebsiteOpsBody(BaseModel):
    url: str | None = None
    token: dict[str, Any] | None = None
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None


@app.get("/api/health")
async def health() -> dict[str, Any]:
    active = resolve_llm(settings)
    providers = provider_status(settings)
    return {
        "ok": True,
        "gmgn_key": bool(settings.gmgn_api_key),
        "opennews_token": bool(settings.opennews_token),
        "llm_key": bool(active),
        "llm_provider": settings.llm_provider,
        "llm_active": (
            {
                "id": active.provider_id,
                "label": active.label,
                "model": active.model,
                "base_url": active.base_url,
            }
            if active
            else None
        ),
        "llm_providers": providers,
        "chains": settings.chains,
        "interval": settings.hot_interval,
        "disclaimer": "仅供研究与教育，非投资建议",
    }


@app.get("/api/llm/providers")
async def llm_providers() -> dict[str, Any]:
    active = resolve_llm(settings)
    return {
        "active": (
            {
                "id": active.provider_id,
                "label": active.label,
                "model": active.model,
            }
            if active
            else None
        ),
        "provider_setting": settings.llm_provider,
        "providers": provider_status(settings),
    }


@app.get("/api/hot")
async def hot_tokens(
    interval: str | None = Query(default=None, description="1h|6h|24h"),
    limit: int = Query(default=0, ge=0, le=100, description="per-chain max, GMGN cap 100"),
    chains: str | None = Query(
        default=None,
        description="comma-separated: sol,bsc,base,eth,robinhood",
    ),
    max_created: str | None = Query(
        default=None,
        description="only tokens younger than this, e.g. 24h|3d|7d|14d|30d; empty=no age filter",
    ),
    analyze: bool = Query(default=False, description="是否对每条做 LLM/启发式叙事分析"),
    with_twitter: bool = Query(default=False, description="分析时是否拉推特"),
    analyze_top: int = Query(default=5, ge=0, le=20, description="每条链分析前 N 名"),
) -> dict[str, Any]:
    """Fetch trending tokens for all GMGN-supported chains (or a subset).

    Prefer ``max_created`` (e.g. 7d) to surface **new** narratives instead of
    old high-volume bluechips that dominate unfiltered volume ranks.
    """
    iv = interval or settings.hot_interval
    lim = limit or settings.hot_limit_per_chain
    chain_list = [c.strip() for c in (chains or settings.hot_chains).split(",") if c.strip()]
    # default: new coins only (7 days) — override with max_created=all or empty via explicit "all"
    age = (max_created if max_created is not None else settings.hot_max_created or "7d").strip()
    if age.lower() in ("", "all", "none", "0", "*"):
        age_filter: str | None = None
    else:
        age_filter = age

    try:
        gmgn = GmgnClient(settings)
    except GmgnError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    async def fetch_chain(chain: str) -> dict[str, Any]:
        try:
            rank = await gmgn.trending(
                chain=chain,
                interval=iv,
                limit=lim,
                max_created=age_filter,
            )
            tokens = [normalize_token(x, chain) for x in rank]
            return {"chain": chain, "ok": True, "count": len(tokens), "tokens": tokens}
        except Exception as e:
            return {"chain": chain, "ok": False, "error": str(e), "count": 0, "tokens": []}

    results = await asyncio.gather(*[fetch_chain(c) for c in chain_list])
    by_chain = {r["chain"]: r for r in results}

    analyses: dict[str, Any] = {}
    if analyze:
        tw: TwitterClient | None = None
        if with_twitter and settings.opennews_token:
            try:
                tw = TwitterClient(settings)
            except TwitterError:
                tw = None

        tasks = []
        meta: list[tuple[str, dict[str, Any]]] = []
        for chain, block in by_chain.items():
            for t in (block.get("tokens") or [])[:analyze_top]:
                key = f"{chain}:{t.get('address')}"
                meta.append((key, t))
                tasks.append(_analyze_one(settings, t, tw if with_twitter else None))

        if tasks:
            outs = await asyncio.gather(*tasks, return_exceptions=True)
            for (key, _), out in zip(meta, outs):
                if isinstance(out, Exception):
                    analyses[key] = {"error": str(out)}
                else:
                    analyses[key] = out

    return {
        "interval": iv,
        "limit_per_chain": lim,
        "max_created": age_filter or "all",
        "chains": chain_list,
        "by_chain": by_chain,
        "analyses": analyses,
        "disclaimer": "仅供研究与教育，非投资建议",
    }


async def _analyze_one(
    settings,
    token: dict[str, Any],
    tw: TwitterClient | None,
    provider: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    profile = None
    tweets: list[dict[str, Any]] = []
    if tw and token.get("twitter_username"):
        try:
            profile = await tw.user_info(token["twitter_username"])
            tweets = await tw.user_tweets(token["twitter_username"], max_results=8)
        except Exception as e:
            profile = {"error": str(e)}
    analysis = await analyze_token(
        settings, token, profile, tweets, provider=provider, model=model
    )
    return {
        "token": {
            "chain": token.get("chain"),
            "address": token.get("address"),
            "symbol": token.get("symbol"),
            "name": token.get("name"),
        },
        "twitter": profile,
        "analysis": analysis,
    }


@app.post("/api/analyze")
async def analyze_endpoint(body: AnalyzeBody) -> dict[str, Any]:
    token = body.token or {
        "chain": body.chain,
        "address": body.address,
        "symbol": body.address[:6],
        "name": body.address[:6],
    }
    token.setdefault("chain", body.chain)
    token.setdefault("address", body.address)

    profile = None
    tweets: list[dict[str, Any]] = []
    if body.include_twitter and settings.opennews_token and token.get("twitter_username"):
        try:
            tw = TwitterClient(settings)
            profile = await tw.user_info(str(token["twitter_username"]))
            tweets = await tw.user_tweets(str(token["twitter_username"]), max_results=8)
        except Exception as e:
            profile = {"error": str(e)}

    analysis = await analyze_token(
        settings,
        token,
        profile,
        tweets,
        provider=body.provider,
        model=body.model,
        api_key=body.api_key,
        base_url=body.base_url,
    )
    return {
        "token": token,
        "twitter": profile,
        "analysis": analysis,
        "disclaimer": "仅供研究与教育，非投资建议",
    }


@app.post("/api/analyze/batch")
async def analyze_batch(body: AnalyzeBatchBody) -> dict[str, Any]:
    tokens = body.tokens[: body.max_tokens]
    tw: TwitterClient | None = None
    if body.include_twitter and settings.opennews_token:
        try:
            tw = TwitterClient(settings)
        except TwitterError:
            tw = None

    results = await asyncio.gather(
        *[
            _analyze_one(
                settings,
                t,
                tw if body.include_twitter else None,
                body.provider,
                body.model,
            )
            for t in tokens
        ],
        return_exceptions=True,
    )
    items = []
    for t, r in zip(tokens, results):
        if isinstance(r, Exception):
            items.append({"token": t, "error": str(r)})
        else:
            items.append(r)
    return {"count": len(items), "items": items, "disclaimer": "仅供研究与教育，非投资建议"}


@app.post("/api/chat")
async def chat_endpoint(body: ChatBody) -> dict[str, Any]:
    """Open-ended co-pilot: recap left+middle panels into user's own ops plan."""
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="message is empty")
    if not resolve_llm(
        settings,
        body.provider,
        body.model,
        api_key_override=body.api_key,
        base_url_override=body.base_url,
    ):
        raise HTTPException(
            status_code=400,
            detail="No LLM provider configured — 请在对话框配置 API Key 或填写 .env",
        )
    try:
        result = await freeform_chat(
            settings,
            message=body.message.strip(),
            history=body.history,
            context=body.context,
            provider=body.provider,
            model=body.model,
            api_key=body.api_key,
            base_url=body.base_url,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {**result, "disclaimer": "仅供研究与教育，非投资建议"}


@app.post("/api/twitter/ops")
async def twitter_ops_endpoint(body: TwitterOpsBody) -> dict[str, Any]:
    """Fetch tweets via 6551 and analyze social ops style."""
    username = (body.username or "").strip().lstrip("@")
    if not username and body.token:
        username = str(
            body.token.get("twitter_username")
            or body.token.get("twitter")
            or ""
        ).strip().lstrip("@")
        # website sometimes is x.com/foo
        if not username:
            site = str(body.token.get("website") or "")
            m = re.search(r"(?:x|twitter)\.com/([A-Za-z0-9_]+)", site, re.I)
            if m:
                username = m.group(1)

    if not username:
        raise HTTPException(
            status_code=400,
            detail="需要 twitter username：请传 username，或 token.twitter_username",
        )
    if not settings.opennews_token:
        raise HTTPException(status_code=400, detail="OPENNEWS_TOKEN is not set")

    try:
        result = await analyze_twitter_ops(
            settings,
            username=username,
            token=body.token,
            question=body.question,
            provider=body.provider,
            model=body.model,
            api_key=body.api_key,
            base_url=body.base_url,
            max_tweets=min(50, max(5, body.max_tweets)),
        )
    except TwitterError as e:
        # soft-fail for UI: still 200 with clean copy (no raw stack)
        return {
            "ok": False,
            "username": username,
            "content": _twitter_fetch_failed_message(
                username, notes=[str(e)]
            ),
            "source": "twitter_error",
            "disclaimer": "仅供研究与教育，非投资建议",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    return {**result, "disclaimer": "仅供研究与教育，非投资建议"}


@app.post("/api/website/ops")
async def website_ops_endpoint(body: WebsiteOpsBody) -> dict[str, Any]:
    """Fetch project website and analyze landing-page / ops design."""
    url = (body.url or "").strip()
    if not url and body.token:
        url = str(body.token.get("website") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="需要 website url 或 token.website")
    try:
        result = await analyze_website(
            settings,
            url=url,
            token=body.token,
            provider=body.provider,
            model=body.model,
            api_key=body.api_key,
            base_url=body.base_url,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {**result, "disclaimer": "仅供研究与教育，非投资建议"}


@app.post("/api/playbook")
async def playbook_endpoint(body: PlaybookBody) -> dict[str, Any]:
    """Generate a reusable ops playbook from benchmark panels."""
    if not body.token and not body.analysis:
        raise HTTPException(status_code=400, detail="需要 token 或 analysis")
    if not resolve_llm(
        settings,
        body.provider,
        body.model,
        api_key_override=body.api_key,
        base_url_override=body.base_url,
    ):
        raise HTTPException(status_code=400, detail="No LLM provider configured")
    try:
        result = await generate_playbook(
            settings,
            token=body.token,
            analysis=body.analysis,
            twitter_ops=body.twitter_ops,
            website_ops=body.website_ops,
            scores=body.scores,
            extra_note=body.note,
            provider=body.provider,
            model=body.model,
            api_key=body.api_key,
            base_url=body.base_url,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {**result, "disclaimer": "仅供研究与教育，非投资建议"}
