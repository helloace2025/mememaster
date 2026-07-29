from __future__ import annotations

import asyncio
import re
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.config import get_settings
from app.services.analyze import analyze_token
from app.services.chat import (
    analyze_twitter_ops,
    fetch_twitter_only,
    freeform_chat,
    generate_playbook,
    _twitter_fetch_failed_message,
)
from app.services.gmgn import GmgnClient, GmgnError, normalize_token
from app.services.lang import disclaimer as lang_disclaimer, normalize_lang
from app.services.llm import provider_status, resolve_llm
from app.services.twitter import TwitterClient, TwitterError, probe_opennews
from app.services.website import analyze_website

settings = get_settings()

app = FastAPI(
    title="MemeMaster API",
    description="热门代币面板 + 叙事/立项分析（研究教育用途，非投资建议）",
    version="0.1.0",
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Never leak bare 500 HTML to the browser for API routes used by the UI."""
    path = request.url.path or ""
    # Keep FastAPI HTTPException behavior
    if isinstance(exc, HTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail, "ok": False},
        )
    # Soft-fail Twitter / website / analyze so the panel never shows "Internal Server Error"
    soft_paths = (
        "/api/twitter/",
        "/api/website/",
        "/api/analyze",
        "/api/playbook",
        "/api/chat",
    )
    if any(path.startswith(p) for p in soft_paths):
        lang = "en"
        try:
            # best-effort: body already consumed — default zh/en from query
            lang = (request.query_params.get("lang") or "zh").lower()
        except Exception:
            pass
        if lang.startswith("en"):
            content = (
                "Something went wrong while processing this request. "
                "Please try **Re-run** in a moment."
            )
        else:
            content = "处理请求时出错，请稍后点「重新分析」再试。"
        return JSONResponse(
            status_code=200,
            content={
                "ok": False,
                "content": content,
                "source": "server_soft_error",
                "error_code": "unhandled",
                "disclaimer": lang_disclaimer(
                    "en" if lang.startswith("en") else "zh"
                ),
            },
        )
    return JSONResponse(
        status_code=500,
        content={"ok": False, "detail": "Internal server error"},
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
    lang: str | None = Field(default=None, description="zh | en — UI language for LLM output")
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
    lang: str | None = None
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None


class ChatBody(BaseModel):
    message: str
    history: list[dict[str, str]] = Field(default_factory=list)
    context: dict[str, Any] | None = None
    lang: str | None = None
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None


class TwitterOpsBody(BaseModel):
    username: str | None = None
    token: dict[str, Any] | None = None
    question: str = "分析这个账号的推文，看它是怎么运营的"
    max_tweets: int = 12
    lang: str | None = None
    # If false: return tweet timeline only (fast, no LLM)
    analyze: bool = True
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None


class TwitterFetchBody(BaseModel):
    username: str | None = None
    token: dict[str, Any] | None = None
    max_tweets: int = 12
    lang: str | None = None


class PlaybookBody(BaseModel):
    token: dict[str, Any] | None = None
    analysis: dict[str, Any] | None = None
    twitter_ops: str | None = None
    website_ops: str | None = None
    scores: list[dict[str, Any]] | None = None
    note: str | None = None
    lang: str | None = None
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None


class WebsiteOpsBody(BaseModel):
    url: str | None = None
    token: dict[str, Any] | None = None
    lang: str | None = None
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None


@app.get("/")
async def root() -> dict[str, Any]:
    """Avoid empty 404 when only the API service is exposed."""
    return {
        "service": "MemeMaster API",
        "ok": True,
        "docs": "/docs",
        "health": "/api/health",
        "hint": "This is the API. The full website is the Next.js app (unified Docker or separate frontend service).",
    }


@app.get("/api/health")
async def health(
    probe_twitter: bool = Query(
        default=False,
        description="if true, live-test 6551 tweet fetch (adds ~1–3s)",
    ),
    username: str = Query(default="elonmusk", description="handle for probe_twitter"),
) -> dict[str, Any]:
    import shutil

    active = resolve_llm(settings)
    providers = provider_status(settings)
    gmgn_cli_path = shutil.which("gmgn-cli")
    body: dict[str, Any] = {
        "ok": True,
        "version": "0.1.1",
        "gmgn_key": bool(settings.gmgn_api_key),
        "gmgn_cli": bool(gmgn_cli_path),
        "gmgn_cli_path": gmgn_cli_path,
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
        "hot_max_created": settings.hot_max_created,
        "endpoints": {
            "twitter_ops": "POST /api/twitter/ops",
            "twitter_probe": "GET /api/health?probe_twitter=1&username=poohrobinhood",
        },
        "disclaimer": "仅供研究与教育，非投资建议",
    }
    if probe_twitter:
        body["twitter_probe"] = await probe_opennews(settings, username=username)
    return body


@app.get("/api/debug/twitter")
@app.get("/api/twitter/probe")
@app.get("/api/twitter/debug")
async def debug_twitter(
    username: str = Query(default="elonmusk", description="X handle to probe"),
) -> dict[str, Any]:
    """Live probe: can this container reach 6551 and pull tweets? (no LLM)."""
    result = await probe_opennews(settings, username=username)
    return {
        **result,
        "hint": (
            "If token_configured=false, set Railway env OPENNEWS_TOKEN. "
            "If ok=false with network/timeout, outbound to ai.6551.io is blocked. "
            "If ok=true, tweet fetch works — UI issues are elsewhere."
        ),
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


@app.get("/api/token")
async def get_token(
    chain: str = Query(default="sol", description="sol|bsc|base|eth|robinhood"),
    address: str = Query(..., description="token contract / mint address"),
    probe: bool = Query(
        default=False,
        description="if true and chain miss, try other supported chains",
    ),
) -> dict[str, Any]:
    """Lookup a custom token by chain + address (not limited to hot board)."""
    addr = (address or "").strip()
    ch = (chain or "sol").strip().lower()
    if not addr:
        raise HTTPException(status_code=400, detail="address is required")
    try:
        gmgn = GmgnClient(settings)
    except GmgnError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    chains_try = [ch]
    if probe:
        for c in settings.chains:
            if c not in chains_try:
                chains_try.append(c)

    last_err: str | None = None
    for c in chains_try:
        try:
            token = await gmgn.token_info(c, addr)
            # treat empty shell as soft fail when probing
            sym = (token.get("symbol") or "").strip()
            name = (token.get("name") or "").strip()
            has_meta = bool(sym and sym not in ("?",) and name)
            has_mkt = bool(token.get("price") or token.get("market_cap") or token.get("volume"))
            if has_meta or has_mkt or not probe or c == chains_try[-1]:
                # always return something for the requested chain on last try
                if not token.get("address"):
                    token["address"] = addr
                if not token.get("symbol"):
                    token["symbol"] = addr[:6] + "…" if len(addr) > 8 else addr
                if not token.get("name"):
                    token["name"] = token["symbol"]
                token["chain"] = c
                token["custom"] = True
                return {
                    "ok": True,
                    "chain": c,
                    "address": addr,
                    "token": token,
                    "probed": c != ch,
                    "disclaimer": "仅供研究与教育，非投资建议",
                }
        except Exception as e:
            last_err = str(e)
            continue

    raise HTTPException(
        status_code=404,
        detail=last_err or f"token not found: {ch}:{addr}",
    )


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
            block: dict[str, Any] = {
                "chain": chain,
                "ok": True,
                "count": len(tokens),
                "tokens": tokens,
            }
            return block
        except Exception as e:
            # Keep error short for API clients; full detail stays in server logs
            msg = str(e)
            if len(msg) > 180:
                msg = msg[:180] + "…"
            return {"chain": chain, "ok": False, "error": msg, "count": 0, "tokens": []}

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
        lang=body.lang,
    )
    return {
        "token": token,
        "twitter": profile,
        "analysis": analysis,
        "disclaimer": lang_disclaimer(normalize_lang(body.lang)),
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
    # 固定使用 DeepSeek，前端传参仅作为可选覆盖
    provider = body.provider or "deepseek"
    model = body.model or None
    api_key = body.api_key or None
    base_url = body.base_url or None

    if not resolve_llm(
        settings,
        provider,
        model,
        api_key_override=api_key,
        base_url_override=base_url,
    ):
        raise HTTPException(
            status_code=400,
            detail="No LLM provider configured — 请在对话框配置 API Key 或填写 .env",
        )
    L = normalize_lang(body.lang)
    try:
        result = await freeform_chat(
            settings,
            message=body.message.strip(),
            history=body.history,
            # Cap context — huge twitter/website dumps make LLM slow → proxy 500
            context=_trim_chat_context(body.context),
            provider=provider,
            model=model,
            api_key=api_key,
            base_url=base_url,
            lang=L,
        )
    except Exception:
        return {
            "ok": False,
            "content": (
                "The model is busy or timed out. Please try again."
                if L == "en"
                else "模型繁忙或超时，请稍后再试。"
            ),
            "source": "chat_error",
            "disclaimer": lang_disclaimer(L),
        }
    return {**result, "disclaimer": lang_disclaimer(L)}


def _trim_chat_context(ctx: dict[str, Any] | None) -> dict[str, Any] | None:
    if not ctx:
        return None
    out = dict(ctx)
    for k in ("twitter_ops_excerpt", "website_ops_excerpt"):
        if isinstance(out.get(k), str) and len(out[k]) > 1200:
            out[k] = out[k][:1200] + "…"
    if isinstance(out.get("token_snapshot"), dict):
        # drop huge nested analysis blobs
        snap = {
            kk: out["token_snapshot"].get(kk)
            for kk in (
                "one_liner",
                "narrative_type",
                "track",
                "verdict",
                "risks",
                "lesson_for_builder",
            )
            if out["token_snapshot"].get(kk) is not None
        }
        out["token_snapshot"] = snap
    return out


def _resolve_twitter_username(
    username: str | None, token: dict[str, Any] | None
) -> tuple[str, str | None]:
    """Return (cleaned_username, error_status). error_status set if unusable."""
    from app.services.gmgn import clean_twitter_username

    u = (username or "").strip()
    if not u and token:
        for key in ("twitter_username", "twitter", "twitter_raw"):
            raw = token.get(key)
            if raw:
                cleaned, st = clean_twitter_username(raw)
                if cleaned and st == "ok":
                    return cleaned, None
        site = str(token.get("website") or "")
        cleaned, st = clean_twitter_username(site)
        if cleaned and st == "ok":
            return cleaned, None
    if u:
        cleaned, st = clean_twitter_username(u)
        if st in ("dead", "community", "missing") or not cleaned:
            return u, st or "bad_handle"
        return cleaned, None
    return "", "missing"


@app.post("/api/twitter/fetch")
async def twitter_fetch_endpoint(body: TwitterFetchBody) -> dict[str, Any]:
    """Fast path: 6551 tweets only — no LLM. Always finishes quickly."""
    L = normalize_lang(body.lang)
    disc = lang_disclaimer(L)
    username, bad = _resolve_twitter_username(body.username, body.token)
    if bad or not username:
        return {
            "ok": False,
            "username": username or "",
            "tweet_count": 0,
            "tweets": [],
            "content": (
                "No valid X handle."
                if L == "en"
                else "无有效 X 账号。"
            ),
            "source": "twitter_bad_handle",
            "disclaimer": disc,
        }
    if not settings.opennews_token:
        return {
            "ok": False,
            "username": username,
            "tweet_count": 0,
            "tweets": [],
            "content": "OPENNEWS_TOKEN is not set",
            "source": "twitter_error",
            "disclaimer": disc,
        }
    try:
        result = await fetch_twitter_only(
            settings,
            username=username,
            max_tweets=min(15, max(5, body.max_tweets or 12)),
            lang=L,
        )
    except Exception as e:
        return {
            "ok": False,
            "username": username,
            "tweet_count": 0,
            "tweets": [],
            "content": _twitter_fetch_failed_message(username, lang=L),
            "source": "twitter_error",
            "error_code": "server_error",
            "disclaimer": disc,
        }
    return {**result, "disclaimer": disc}


@app.post("/api/twitter/ops")
async def twitter_ops_endpoint(body: TwitterOpsBody) -> dict[str, Any]:
    """Fetch tweets via 6551 OpenNews REST + optional LLM ops analysis."""
    L = normalize_lang(body.lang)
    disc = lang_disclaimer(L)
    username, bad = _resolve_twitter_username(body.username, body.token)
    if bad or not username:
        if L == "en":
            msg = (
                f"Invalid X link or Community/deleted account (status={bad}); cannot fetch tweets. "
                "Pick a token with a real @handle."
            )
        else:
            msg = (
                f"X 链接无效或为 Community/已删除账号（status={bad}），无法抓推文。"
                " 请换有真实 @handle 的代币。"
            )
        return {
            "ok": False,
            "username": username or "",
            "content": msg,
            "source": "twitter_bad_handle",
            "error_code": bad or "bad_handle",
            "disclaimer": disc,
        }

    if not settings.opennews_token:
        raise HTTPException(
            status_code=400,
            detail="OPENNEWS_TOKEN is not set",
        )

    # Fast path: timeline only (UI calls this first)
    if not body.analyze:
        try:
            result = await fetch_twitter_only(
                settings,
                username=username,
                max_tweets=min(15, max(5, body.max_tweets or 12)),
                lang=L,
            )
        except Exception:
            return {
                "ok": False,
                "username": username,
                "content": _twitter_fetch_failed_message(username, lang=L),
                "source": "twitter_error",
                "disclaimer": disc,
            }
        return {**result, "disclaimer": disc}

    try:
        result = await analyze_twitter_ops(
            settings,
            username=username,
            token=body.token,
            question=body.question,
            # Prefer server-side LLM keys — client overrides often break under load
            provider=body.provider if body.api_key else None,
            model=body.model if body.api_key else None,
            api_key=body.api_key or None,
            base_url=body.base_url if body.api_key else None,
            max_tweets=min(12, max(5, body.max_tweets or 12)),
            lang=L,
        )
    except TwitterError as e:
        return {
            "ok": False,
            "username": username,
            "content": _twitter_fetch_failed_message(
                username, notes=[str(e)], lang=L
            ),
            "source": "twitter_error",
            "disclaimer": disc,
        }
    except Exception as e:
        return {
            "ok": False,
            "username": username,
            "content": _twitter_fetch_failed_message(
                username, notes=[str(e)], lang=L
            ),
            "source": "twitter_error",
            "error_code": "server_error",
            "disclaimer": disc,
        }

    return {**result, "disclaimer": disc}


@app.post("/api/website/ops")
async def website_ops_endpoint(body: WebsiteOpsBody) -> dict[str, Any]:
    """Fetch project website and analyze landing-page / ops design."""
    L = normalize_lang(body.lang)
    url = (body.url or "").strip()
    if not url and body.token:
        url = str(body.token.get("website") or "").strip()
    if not url:
        raise HTTPException(
            status_code=400,
            detail="website url required" if L == "en" else "需要 website url 或 token.website",
        )
    try:
        result = await analyze_website(
            settings,
            url=url,
            token=body.token,
            provider=body.provider,
            model=body.model,
            api_key=body.api_key,
            base_url=body.base_url,
            lang=L,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {**result, "disclaimer": lang_disclaimer(L)}


@app.post("/api/playbook")
async def playbook_endpoint(body: PlaybookBody) -> dict[str, Any]:
    """Generate a reusable ops playbook from benchmark panels."""
    L = normalize_lang(body.lang)
    if not body.token and not body.analysis:
        raise HTTPException(
            status_code=400,
            detail="token or analysis required" if L == "en" else "需要 token 或 analysis",
        )
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
            lang=L,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {**result, "disclaimer": lang_disclaimer(L)}


@app.post("/api/agent")
async def agent_endpoint(body: ChatBody) -> dict[str, Any]:
    """A2MCP endpoint: fetch real data (GMGN + Twitter) then LLM analysis."""
    L = normalize_lang(body.lang)
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="message is empty")

    # 1. 拿真实 GMGN 热点数据
    from app.services.gmgn import GmgnClient, GmgnError

    try:
        gmgn = GmgnClient(settings)
        hot_data = []
        for chain in ["sol", "bsc", "base", "eth", "robinhood"]:
            try:
                rank = await gmgn.trending(
                    chain=chain, interval="24h", limit=5, max_created="7d"
                )
                for t in rank[:3]:
                    hot_data.append(
                        {
                            "chain": chain,
                            "symbol": t.get("symbol", "?"),
                            "name": t.get("name", "?"),
                            "address": t.get("address", ""),
                            "market_cap": t.get("market_cap", 0),
                            "volume": t.get("volume", 0),
                            "price_change": t.get("price_change_percent", 0),
                            "price": t.get("price", 0),
                            "liquidity": t.get("liquidity", 0),
                            "holder_count": t.get("holder_count", 0),
                            "swaps": t.get("swaps", 0),
                            "url": f"https://gmgn.ai/{chain}/token/{t.get('address','')}" if t.get("address") else "",
                        }
                    )
            except Exception:
                pass
    except GmgnError:
        hot_data = []

    # 2. 组装真实数据上下文后调 LLM 分析
    ctx: dict[str, Any] = {"hot_board": hot_data} if hot_data else {}
    result = await freeform_chat(
        settings,
        message=body.message.strip(),
        history=body.history,
        context=ctx,
        provider="deepseek",
        model=None,
        api_key=None,
        base_url=None,
        lang=L,
    )
    return {
        **result,
        "data_sources": {"gmgn": bool(hot_data), "opennews": bool(settings.opennews_token)},
        "disclaimer": lang_disclaimer(L),
    }
