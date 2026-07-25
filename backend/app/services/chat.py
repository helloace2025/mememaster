"""Freeform co-pilot chat + Twitter / website ops analysis."""

from __future__ import annotations

import json
import re
from typing import Any

import logging

from app.config import Settings
from app.services.lang import Lang, normalize_lang, with_lang
from app.services.llm import chat_json, resolve_llm, openai_client, ResolvedLLM
from app.services.twitter import TwitterClient, TwitterError

log = logging.getLogger("mememaster.chat")

COPILOT_SYSTEM_ZH = """你是 MemeMaster「运营共创副驾驶」——帮用户**复盘左侧盘面 + 中间推特/网站拆解**，沉淀成自己的运营思路。

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

COPILOT_SYSTEM_EN = """You are MemeMaster ops co-pilot. Help the user turn the board + Twitter/website teardown into their own playbook.

Scope:
- How others launch (first post hook, concept, visuals, site conversion)
- Actionable paths: content cadence, visual system, landing page, reskinned plan, SOP
- Research/education only — not investment advice; never invent on-chain stats or fake tweets
- Learn structure, do not copy skin

Formatting:
- **English** Markdown; real newlines; blank lines around ## / ###
- One list item per line; no Markdown tables for calendars — use ### Day 1 + bullets
- Checklists with `- [ ]`
"""

OPS_SYSTEM_ZH = """你是 meme 项目「推特立项路径」拆解教练。

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

OPS_SYSTEM_EN = """You are a meme project coach for **Twitter launch-path teardown**.

Hard rules:
1. Analyze **only** real tweet text / media URLs / materials in the user message.
2. **Never** invent tweets or launch paths from the handle, ticker, or chain data alone.
3. If recent_tweets is empty: only say "No tweet evidence — cannot analyze."
4. Quote original fragments; if missing write "Not shown in tweets".

When tweets exist, cover: first hook post, concept intro, project content line, visual system, overall ops.

Write **English** Markdown (not JSON):

## 1. Launch path (timeline)
## 2. First / key hook post
## 3. How the concept is explained
## 4. Visual system (evidence only)
## 5. Cadence & account persona
## 6. Reusable plays (3–6)
## 7. Risks & red flags

Formatting: real newlines; blank lines around headings; no Markdown tables; no escaped \\n.
"""


def ops_system(lang: Lang) -> str:
    return with_lang(OPS_SYSTEM_EN if lang == "en" else OPS_SYSTEM_ZH, lang)


def copilot_system(lang: Lang) -> str:
    return with_lang(COPILOT_SYSTEM_EN if lang == "en" else COPILOT_SYSTEM_ZH, lang)


def playbook_system(lang: Lang) -> str:
    if lang == "en":
        body = """You are MemeMaster playbook author. From the board + Twitter ops + website teardown, write a **user's own** ops plan.

Rules:
1. Research only — not investment advice; learn structure, do not copy skin
2. **English** Markdown:

# Ops playbook (benchmark $SYMBOL → my launch)

## 0. One-line takeaway (learn / change / skip)
## 1. Launch path (my hook)
## 2. Twitter ops
### 2.1 Persona
### 2.2 Visual system brief
### 2.3 Content cadence (use ### Day 1 — no tables)
### 2.4 Engagement rules
## 3. Website / landing
## 4. Must-change skin vs benchmark
## 5. Risks & taste red lines

Output the user's version; benchmark is structure-only.
Formatting: real newlines; blank lines around headings; one bullet per line."""
    else:
        body = """你是 MemeMaster「运营思路」作者。基于对标盘的盘面 + 推特运营拆解 + 网站拆解，写一份**用户自己可用的运营方案**。

要求：
1. 研究教育，非投资建议；学结构不抄皮
2. 中文 Markdown，结构固定：

# 运营思路（对标 $SYMBOL → 我的盘）

## 0. 一句话结论（学什么 / 改什么 / 不学什么）
## 1. 立项路径（我怎么切入）
## 2. 推特运营
### 2.1 人设
### 2.2 视觉系统 brief
### 2.3 内容节奏日历（### Day 1，禁止表格）
### 2.4 互动规则
## 3. 网站 / 落地页
## 4. 和对照盘的差异点（必须换掉的皮）
## 5. 风险与品味红线

3. 输出必须是「用户自己的盘」版本，对标只作结构参考
4. **排版硬性**：真实换行；每个 ## / ### 前后空一行；列表一项一行"""
    return with_lang(body, lang)


def _twitter_fetch_failed_message(
    username: str,
    *,
    notes: list[str] | None = None,
    profile: dict[str, Any] | None = None,
    profile_error: str | None = None,
    lang: Lang = "zh",
) -> str:
    """Short, clean failure copy — no stack traces, no speculation."""
    handle = (username or "").lstrip("@").strip() or "unknown"
    _ = (notes, profile, profile_error)
    if lang == "en":
        return (
            f"**Could not fetch tweets for @{handle}**\n\n"
            f"Check whether the X account is suspended, deleted, restricted, "
            f"or the linked username is wrong.\n\n"
            f"We do not invent an ops path without real tweets. "
            f"Use **Re-run** later or refresh."
        )
    return (
        f"**未能获取 @{handle} 的推文**\n\n"
        f"请检查该用户的推特账号是否异常"
        f"（如被封禁、注销、限制可见，或绑定的用户名有误）。\n\n"
        f"没有真实推文时，不会编造运营路径。"
        f"可点右上角「重新分析」再试，或稍后再刷新。"
    )


# Back-compat aliases
COPILOT_SYSTEM = COPILOT_SYSTEM_ZH
OPS_SYSTEM = OPS_SYSTEM_ZH
PLAYBOOK_SYSTEM = playbook_system("zh")

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
    tweets_compact = compact_tweets(tweets, max_tweets)

    return {
        "username": username,
        "profile": profile,
        "profile_error": profile_error,
        "tweets": tweets,
        "tweets_compact": tweets_compact,
        # count compact (what LLM / UI actually sees)
        "tweet_count": len(tweets_compact),
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
    lang: str | None = None,
) -> dict[str, Any]:
    L = normalize_lang(lang)
    try:
        bundle = await fetch_twitter_bundle(settings, username, max_tweets=max_tweets)
    except TwitterError as e:
        log.warning("twitter fetch error @%s: %s", username, e)
        return {
            "ok": False,
            "username": username,
            "profile": None,
            "tweets": [],
            "tweet_count": 0,
            "content": _twitter_fetch_failed_message(username, lang=L),
            "source": "twitter_error",
            "error_code": "twitter_api_error",
        }

    notes = bundle.get("fetch_notes") or []
    if notes:
        log.info("twitter fetch notes @%s: %s", username, " | ".join(notes[:8]))
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
                profile=bundle.get("profile") if isinstance(bundle.get("profile"), dict) else None,
                profile_error=bundle.get("profile_error"),
                lang=L,
            ),
            "source": "twitter_empty",
            "error_code": "no_tweets",
        }

    if L == "en":
        q_default = "Using only real tweets, teardown launch path and social ops"
        rules = "Use only recent_tweets; never invent missing posts. Analysis in English."
        prompt_head = (
            "Real tweets below. Rebuild the launch path only from recent_tweets; "
            "do not invent content not present. Output fully in English:\n"
        )
    else:
        q_default = "基于真实推文拆解立项路径与运营"
        rules = "只能依据 recent_tweets；禁止编造未出现的推文内容"
        prompt_head = (
            "以下为真实抓取的推文数据。请严格依据 recent_tweets 还原立项路径；"
            "没有写在推文里的内容不要编造：\n"
        )

    # Never send internal fetch diagnostics to the model (leaks into UI prose).
    user_payload = {
        "question": question or q_default,
        "lang": L,
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
        "rules": rules,
    }

    prompt = prompt_head + json.dumps(user_payload, ensure_ascii=False, default=str)[:24000]
    try:
        content, resolved = await chat_text(
            settings,
            ops_system(L),
            prompt,
            provider=provider,
            model=model,
            api_key=api_key,
            base_url=base_url,
            temperature=0.4,
        )
    except Exception as llm_err:
        # Tweets OK — surface a clean summary, no stack/API internals
        log.warning("twitter ops LLM failed @%s: %s", username, llm_err)
        if L == "en":
            lines = [
                f"## @{username} — {len(tweets_compact)} tweets fetched",
                "Model analysis failed; recent posts listed below.",
                "",
                "### Recent tweets",
            ]
        else:
            lines = [
                f"## @{username} — 已抓取 {len(tweets_compact)} 条推文",
                "模型分析暂时失败，以下为最近推文摘要。",
                "",
                "### 最近推文",
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
            "error_code": "llm_failed_after_fetch",
            "lang": L,
        }

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
        "lang": L,
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
    lang: str | None = None,
) -> dict[str, Any]:
    L = normalize_lang(lang)
    ctx = context or {}
    user = message
    if ctx:
        if L == "en":
            user = (
                f"[Session context]\n{json.dumps(ctx, ensure_ascii=False, default=str)[:6000]}\n\n"
                f"[User]\n{message}"
            )
        else:
            user = (
                f"【会话上下文，可参考】\n{json.dumps(ctx, ensure_ascii=False, default=str)[:6000]}\n\n"
                f"【用户】\n{message}"
            )
    content, resolved = await chat_text(
        settings,
        copilot_system(L),
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
    lang: str | None = None,
) -> dict[str, Any]:
    """Synthesize a reusable ops playbook from left/middle panel materials."""
    L = normalize_lang(lang)
    if not resolve_llm(
        settings, provider, model, api_key_override=api_key, base_url_override=base_url
    ):
        raise RuntimeError("No LLM provider configured")

    sym = (token or {}).get("symbol") or "TOKEN"
    if L == "en":
        goal = "Write the user's own ops plan: launch path + Twitter + website; learn structure, not skin"
        user = (
            f"Benchmark ${sym}. Output a full English ops playbook Markdown (user's version).\n"
            f"Materials:\n"
        )
    else:
        goal = "生成用户自己的运营思路：立项路径 + 推特 + 网站，学结构不抄皮"
        user = (
            f"对标 ${sym}。请输出完整「运营思路」Markdown（用户自己的版本）。\n"
            f"材料：\n"
        )
    payload = {
        "benchmark_token": token,
        "token_snapshot": analysis,
        "structure_scores": scores,
        "twitter_ops_excerpt": (twitter_ops or "")[:4500],
        "website_ops_excerpt": (website_ops or "")[:3500],
        "user_note": extra_note or "",
        "goal": goal,
        "lang": L,
    }
    user = user + json.dumps(payload, ensure_ascii=False, default=str)[:16000]
    content, resolved = await chat_text(
        settings,
        playbook_system(L),
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
        "lang": L,
    }
