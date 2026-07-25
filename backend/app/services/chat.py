"""Freeform co-pilot chat + Twitter / website ops analysis."""

from __future__ import annotations

import json
import re
from typing import Any

from app.config import Settings
from app.services.llm import chat_json, resolve_llm, openai_client, ResolvedLLM
from app.services.twitter import TwitterClient, TwitterError

COPILOT_SYSTEM = """你是 MemeMaster「运营共创副驾驶」——帮用户**复盘左侧盘面 + 中间推特/网站拆解**，沉淀成自己的运营思路。

能力边界：
- 对标别人怎么立项（第一条推文怎么切入、概念怎么讲、视觉怎么立、网站怎么转化）
- 输出可执行：运营路径、内容节奏、视觉系统、落地页要点、换皮后的自己的方案、运营 SOP
- 研究教育，非投资建议；缺数据就说缺什么，不编造链上数/假推文/假配图
- 学结构不抄皮（角色/商标/假官方禁止）

排版（很重要，便于阅读）：
- 中文 Markdown；**真实换行**，禁止字面 \\n，禁止把多段挤成一行
- 每个 ## / ### 标题前后各空一行
- 列表一项一行；一段不要超过 3 行
- 内容日历、节奏表：**禁止用 Markdown 表格**；改用「### Day 1」+ 列表
- 清单用 `- [ ]`
"""

OPS_SYSTEM = """你是 meme 项目「推特立项路径」拆解教练。

硬性规则（违反即不合格）：
1. **只根据用户消息里提供的真实推文正文 / 配图 URL / 抓取资料分析**。
2. **禁止**根据用户名、昵称、代币名、赛道常识、链上数据去编造「可能发了什么推文」「可能的切入路径」。
3. 若 recent_tweets 为空或缺失：不要写立项时间线；只输出一句「无推文证据，无法分析」。
4. 引用时尽量点明推文里的原话片段；没有的内容写「推文未体现」，不要补脑。

核心问题（有推文时按时间线回答）：
1. 第一条/最早可见推文发了什么？怎么切入？
2. 概念是怎么介绍出来的？
3. 项目本身怎么嵌进内容线？
4. 配图与视觉系统（仅基于提供的 media / 描述）
5. 整体运营线路

用中文 Markdown 输出（不要 JSON），结构固定：

## 1. 立项路径（时间线）
## 2. 第一条/关键切入帖
## 3. 概念怎么讲清楚
## 4. 视觉系统（仅证据内）
## 5. 内容节奏与账号人设
## 6. 可复用打法（3–6 条）
## 7. 风险与槽点

排版硬性要求：
- **真实换行**；每个 ## / ### 前后空一行
- 列表一项一行；禁止把表格/多天日历压成一行
- **不要用 Markdown 表格**；日历/节奏用 ### Day 1 + 无序列表
- 不要 \\n 转义、不要 JSON
"""


def _twitter_fetch_failed_message(
    username: str,
    *,
    notes: list[str] | None = None,
    profile: dict[str, Any] | None = None,
    profile_error: str | None = None,
) -> str:
    """Short, clean failure copy — no stack traces, no speculation."""
    handle = (username or "").lstrip("@").strip() or "unknown"
    # notes/profile kept for API logging callers; not dumped into UI copy
    _ = (notes, profile, profile_error)
    return (
        f"**未能获取 @{handle} 的推文**\n\n"
        f"请检查该用户的推特账号是否异常"
        f"（如被封禁、注销、限制可见，或绑定的用户名有误）。\n\n"
        f"没有真实推文时，不会编造运营路径。"
        f"可点右上角「重新分析」再试，或稍后再刷新。"
    )

PLAYBOOK_SYSTEM = """你是 MemeMaster「运营思路」作者。基于对标盘的盘面 + 推特运营拆解 + 网站拆解，写一份**用户自己可用的运营方案**。

要求：
1. 研究教育，非投资建议；学结构不抄皮
2. 中文 Markdown，结构固定：

# 运营思路（对标 $SYMBOL → 我的盘）

## 0. 一句话结论（学什么 / 改什么 / 不学什么）

## 1. 立项路径（我怎么切入）
- 第一条推文角度草案
- 概念怎么三句话说清
- 发射前后内容线

## 2. 推特运营

### 2.1 人设
（2–4 条列表）

### 2.2 视觉系统 brief
（角色 / 主色 / 资产清单，列表）

### 2.3 内容节奏日历
**禁止 Markdown 表格。** 按天拆开写，例如：

### Day 1（密集期）
- 内容类型：
- 目的：
- 输出要点：
- 示例角度：（非照抄原文）

### Day 2（加速期）
- …

### Day 3（成熟期）
- …

### 2.4 互动规则
（列表，一项一行）

## 3. 网站 / 落地页
- 要不要站、首屏信息架构
- 转化入口（社交/买/社群）

## 4. 和对照盘的差异点（必须换掉的皮）

## 5. 风险与品味红线

3. 输出必须是「用户自己的盘」版本，对标只作结构参考
4. **排版硬性**：真实换行；每个 ## / ### 前后空一行；列表一项一行；**禁止**把多天内容挤进一行或用宽表格
"""

async def chat_text(
    settings: Settings,
    system: str,
    user: str,
    *,
    history: list[dict[str, str]] | None = None,
    provider: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    temperature: float = 0.5,
) -> tuple[str, ResolvedLLM]:
    """Plain-text chat (not forced JSON)."""
    resolved = resolve_llm(
        settings,
        provider,
        model,
        api_key_override=api_key,
        base_url_override=base_url,
    )
    if not resolved:
        raise RuntimeError("No LLM provider configured — 请填写 API Key")

    messages: list[dict[str, str]] = [{"role": "system", "content": system}]
    if history:
        for h in history[-16:]:
            role = h.get("role")
            content = (h.get("content") or "").strip()
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content[:6000]})
    messages.append({"role": "user", "content": user})

    if resolved.api_style == "anthropic":
        # reuse anthropic path via temporary import
        from app.services.llm import _anthropic_json

        # _anthropic_json expects system+user; fold history into user for simplicity
        hist_txt = ""
        if history:
            hist_txt = "\n\n".join(
                f"{h.get('role')}: {h.get('content')}" for h in history[-10:]
            )
            user = f"对话历史：\n{hist_txt}\n\n当前用户：\n{user}"
        # anthropic helper was built for JSON; still works for free text
        text = await _anthropic_json(resolved, system, user, temperature)
        return text, resolved

    client = openai_client(resolved)
    resp = await client.chat.completions.create(
        model=resolved.model,
        temperature=temperature,
        messages=messages,
    )
    content = resp.choices[0].message.content or ""
    return content, resolved


def _tweet_text(t: dict[str, Any]) -> str:
    for k in ("text", "full_text", "content", "tweet", "body"):
        v = t.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    # nested
    for k in ("legacy", "data"):
        inner = t.get(k)
        if isinstance(inner, dict):
            s = _tweet_text(inner)
            if s:
                return s
    return json.dumps(t, ensure_ascii=False)[:400]


def _tweet_time(t: dict[str, Any]) -> str:
    for k in ("createdAt", "created_at", "time", "posted_at", "date"):
        v = t.get(k)
        if v is not None:
            return str(v)
    return ""


def _tweet_media(t: dict[str, Any]) -> list[str]:
    """Best-effort media URL extraction from 6551 / X payloads."""
    urls: list[str] = []
    seen: set[str] = set()

    def add(u: Any) -> None:
        if isinstance(u, str) and u.startswith("http") and u not in seen:
            seen.add(u)
            urls.append(u[:400])

    for key in ("media", "medias", "images", "photos", "extendedEntities", "extended_entities"):
        block = t.get(key)
        if isinstance(block, list):
            for item in block:
                if isinstance(item, str):
                    add(item)
                elif isinstance(item, dict):
                    for k in (
                        "url",
                        "media_url",
                        "media_url_https",
                        "preview_image_url",
                        "mediaUrl",
                        "mediaUrlHttps",
                    ):
                        add(item.get(k))
                    # nested media variants
                    for k in ("media", "image", "photo"):
                        inner = item.get(k)
                        if isinstance(inner, dict):
                            add(inner.get("url") or inner.get("media_url_https"))
                        elif isinstance(inner, str):
                            add(inner)
        elif isinstance(block, dict):
            media_list = block.get("media") or block.get("images") or []
            if isinstance(media_list, list):
                for item in media_list:
                    if isinstance(item, dict):
                        add(
                            item.get("media_url_https")
                            or item.get("media_url")
                            or item.get("url")
                        )

    # entities.media
    entities = t.get("entities") or t.get("legacy", {}).get("entities") if isinstance(t.get("legacy"), dict) else t.get("entities")
    if isinstance(entities, dict):
        for item in entities.get("media") or []:
            if isinstance(item, dict):
                add(item.get("media_url_https") or item.get("media_url") or item.get("url"))

    return urls[:6]


def compact_tweets(tweets: list[dict[str, Any]], limit: int = 20) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for t in tweets[:limit]:
        if not isinstance(t, dict):
            continue
        media = _tweet_media(t)
        row: dict[str, Any] = {
            "text": _tweet_text(t)[:800],
            "time": _tweet_time(t),
            "likes": str(
                t.get("favoriteCount")
                or t.get("like_count")
                or t.get("likes")
                or t.get("favorite_count")
                or ""
            ),
            "rts": str(
                t.get("retweetCount")
                or t.get("retweet_count")
                or t.get("retweets")
                or ""
            ),
        }
        if media:
            row["media"] = media
            row["has_media"] = True
        out.append(row)
    return out

async def fetch_twitter_bundle(
    settings: Settings,
    username: str,
    max_tweets: int = 25,
) -> dict[str, Any]:
    if not settings.opennews_token:
        raise TwitterError("OPENNEWS_TOKEN is not set")
    tw = TwitterClient(settings)
    username = username.lstrip("@").strip()

    profile: dict[str, Any] | None = None
    profile_error: str | None = None
    try:
        profile = await tw.user_info(username)
    except TwitterError as e:
        profile_error = str(e)

    tweets, fetch_notes = await tw.user_tweets_resilient(username, max_results=max_tweets)

    return {
        "username": username,
        "profile": profile,
        "profile_error": profile_error,
        "tweets": tweets,
        "tweets_compact": compact_tweets(tweets, max_tweets),
        "tweet_count": len(tweets),
        "fetch_notes": fetch_notes,
    }


async def analyze_twitter_ops(
    settings: Settings,
    *,
    username: str,
    token: dict[str, Any] | None = None,
    question: str = "",
    provider: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    max_tweets: int = 25,
) -> dict[str, Any]:
    try:
        bundle = await fetch_twitter_bundle(settings, username, max_tweets=max_tweets)
    except TwitterError as e:
        return {
            "ok": False,
            "username": username,
            "profile": None,
            "tweets": [],
            "tweet_count": 0,
            "content": _twitter_fetch_failed_message(
                username,
                notes=[f"6551 接口错误: {e}"],
            ),
            "source": "twitter_error",
            "fetch_notes": [str(e)],
            "error_code": "twitter_api_error",
        }

    notes = bundle.get("fetch_notes") or []
    tweets_compact = bundle.get("tweets_compact") or []

    # No tweets → hard stop. Never ask LLM to invent an ops path from handle/bio.
    if not tweets_compact:
        return {
            "ok": False,
            "username": username,
            "profile": bundle.get("profile"),
            "tweets": [],
            "tweet_count": 0,
            "content": _twitter_fetch_failed_message(
                username,
                notes=notes,
                profile=bundle.get("profile") if isinstance(bundle.get("profile"), dict) else None,
                profile_error=bundle.get("profile_error"),
            ),
            "source": "twitter_empty",
            "fetch_notes": notes,
            "error_code": "no_tweets",
        }

    user_payload = {
        "question": question or "基于真实推文拆解立项路径与运营",
        "token": {
            "symbol": (token or {}).get("symbol"),
            "name": (token or {}).get("name"),
            "chain": (token or {}).get("chain"),
        }
        if token
        else None,
        "twitter_profile": bundle.get("profile"),
        "recent_tweets": tweets_compact,
        "tweet_count": bundle.get("tweet_count"),
        "fetch_notes": notes,
        "rules": "只能依据 recent_tweets；禁止编造未出现的推文内容",
    }

    prompt = (
        "以下为 6551 真实抓取的推文数据。请严格依据 recent_tweets 还原立项路径；"
        "没有写在推文里的内容不要编造：\n"
        + json.dumps(user_payload, ensure_ascii=False, default=str)[:24000]
    )
    try:
        content, resolved = await chat_text(
            settings,
            OPS_SYSTEM,
            prompt,
            provider=provider,
            model=model,
            api_key=api_key,
            base_url=base_url,
            temperature=0.4,
        )
    except Exception as llm_err:
        # Tweets were fetched successfully — never 500 the whole ops panel
        # just because the model timed out / errored.
        lines = [
            f"## @{username} 推文已抓到（{len(tweets_compact)} 条），但模型分析失败",
            f"原因：{llm_err}",
            "",
            "### 最近推文摘要",
        ]
        for i, t in enumerate(tweets_compact[:12], 1):
            text = str((t or {}).get("text") or "")[:220]
            tm = str((t or {}).get("time") or "")
            lines.append(f"{i}. [{tm}] {text}")
        return {
            "ok": True,
            "username": username,
            "profile": bundle.get("profile"),
            "tweets": tweets_compact,
            "tweet_count": bundle.get("tweet_count"),
            "content": "\n".join(lines),
            "provider": None,
            "model": None,
            "source": "twitter_ops_partial",
            "fetch_notes": notes + [f"llm_error: {llm_err}"],
            "error_code": "llm_failed_after_fetch",
        }

    # soft prefix if we had to use fallback strategy
    if notes and any("备用" in n or "降级" in n for n in notes):
        content = f"（数据拉取备注：{notes[-1]}）\n\n" + content

    return {
        "ok": True,
        "username": username,
        "profile": bundle.get("profile"),
        "tweets": bundle.get("tweets_compact"),
        "tweet_count": bundle.get("tweet_count"),
        "content": content,
        "provider": resolved.provider_id,
        "model": resolved.model,
        "source": "twitter_ops",
        "fetch_notes": notes,
    }


async def freeform_chat(
    settings: Settings,
    *,
    message: str,
    history: list[dict[str, str]] | None = None,
    context: dict[str, Any] | None = None,
    provider: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
) -> dict[str, Any]:
    ctx = context or {}
    user = message
    if ctx:
        user = (
            f"【会话上下文，可参考】\n{json.dumps(ctx, ensure_ascii=False, default=str)[:6000]}\n\n"
            f"【用户】\n{message}"
        )
    content, resolved = await chat_text(
        settings,
        COPILOT_SYSTEM,
        user,
        history=history,
        provider=provider,
        model=model,
        api_key=api_key,
        base_url=base_url,
        temperature=0.55,
    )
    return {
        "content": content,
        "provider": resolved.provider_id,
        "model": resolved.model,
        "source": "chat",
    }


async def generate_playbook(
    settings: Settings,
    *,
    token: dict[str, Any] | None = None,
    analysis: dict[str, Any] | None = None,
    twitter_ops: str | None = None,
    website_ops: str | None = None,
    scores: list[dict[str, Any]] | None = None,
    extra_note: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Synthesize a reusable ops playbook from left/middle panel materials."""
    if not resolve_llm(
        settings, provider, model, api_key_override=api_key, base_url_override=base_url
    ):
        raise RuntimeError("No LLM provider configured")

    sym = (token or {}).get("symbol") or "TOKEN"
    payload = {
        "benchmark_token": token,
        "token_snapshot": analysis,
        "structure_scores": scores,
        "twitter_ops_excerpt": (twitter_ops or "")[:4500],
        "website_ops_excerpt": (website_ops or "")[:3500],
        "user_note": extra_note or "",
        "goal": "生成用户自己的运营思路：立项路径 + 推特 + 网站，学结构不抄皮",
    }
    user = (
        f"对标 ${sym}。请输出完整「运营思路」Markdown（用户自己的版本）。\n"
        f"材料：\n{json.dumps(payload, ensure_ascii=False, default=str)[:16000]}"
    )
    content, resolved = await chat_text(
        settings,
        PLAYBOOK_SYSTEM,
        user,
        provider=provider,
        model=model,
        api_key=api_key,
        base_url=base_url,
        temperature=0.45,
    )
    return {
        "content": content,
        "provider": resolved.provider_id,
        "model": resolved.model,
        "source": "playbook",
        "symbol": sym,
    }
