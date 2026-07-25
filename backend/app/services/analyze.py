"""Narrative / project analysis — 4-dimension builder guide + 欲·局·信."""

from __future__ import annotations

import json
import re
from typing import Any

from app.config import Settings
from app.services.llm import chat_json, resolve_llm

SYSTEM_PROMPT = """你是 MemeMaster「选题共创副驾驶」的分析引擎。
任务：基于链上热门代币元数据 + 可选推特资料/推文，输出**可复用的发币指导**（研究教育，非投资建议）。

核心目标（不是喊单）：
- 拆解别人怎么立项叙事、做视觉门面、做站、做推特
- 提炼「可学结构 vs 不可抄皮」
- 给开发者可执行 checklist（视觉 / 设计 / 网站 / 推特运营）

原则：
1. 只对标可迁移前端（叙事、情绪、IP、节奏、包装），不教操纵盘/割韭菜。
2. 信息不足时降置信度，明确写「证据不足」，禁止编造推文原文或虚假链上数。
3. 输出必须是严格 JSON，不要 markdown 代码块。

输出 JSON schema（字段尽量填满；未知用空串/空数组/合理默认分）：
{
  "narrative_type": "赛道类型，如 动物meme/AI agent/本地梗/IP二创/纯流速",
  "track": "更细赛道标签，2-6字",
  "ip_angle": "IP/角色角度一句话",
  "one_liner": "小孩也能复述的一句话立项",
  "emotional_hook": "情绪钩子",
  "desire": {"score": 0-10, "note": "欲：身份/口令/转发欲"},
  "game": {"score": 0-10, "note": "局：可参与动作"},
  "trust": {"score": 0-10, "note": "信：筹码/dev/观感"},
  "ip_strength": {"memeable": 0-10, "ownable": 0-10, "visualizable": 0-10},
  "why_hot_today": "为什么今天热",
  "risks": ["..."],
  "lesson_for_builder": "做盘人可学的结构（非抄皮）",
  "copy_vs_create": "一句话：学什么结构、必须换什么皮",
  "verdict": "值得学结构 / 仅流速 / 谨慎 / 不学",
  "confidence": 0.0-1.0,
  "guide": {
    "narrative": {
      "summary": "叙事怎么立的",
      "one_liner_template": "可借鉴的句式模板（换主体）",
      "differentiator": "它的尖点",
      "do": ["可学1", "可学2"],
      "dont": ["勿抄1"],
      "checklist": ["具体可勾选的自检问题，口语化，例如：朋友5秒说得清吗？"]
    },
    "visual": {
      "summary": "视觉/角色门面观察（基于名字/logo/文案推断）",
      "character": "角色或符号是什么",
      "style_keywords": ["扁平", "丑萌", "..."],
      "assets": ["建议资产清单：主视觉/头像/表情包..."],
      "do": ["..."],
      "dont": ["..."],
      "checklist": ["缩小成头像能认出吗？", "会有人当表情包转吗？"]
    },
    "website": {
      "summary": "官网/落地页观察（有无站、信息是否够）",
      "has_site": true,
      "modules": ["首屏口号+图", "故事", "社交入口", "..."],
      "ia_outline": ["单页推荐模块顺序"],
      "do": ["..."],
      "dont": ["..."],
      "checklist": ["打开10秒知道是什么币吗？", "手机一屏能点到社交链接吗？"]
    },
    "twitter": {
      "summary": "推特门面与运营线索（资料不足则弱推断；账号已注销则标明无价值）",
      "persona": "人设",
      "cadence": "节奏（证据不足要说明）",
      "content_mix": ["内容类型占比猜测"],
      "pre_ca_playbook": ["预热→发合约 可学步骤"],
      "sample_angles": ["3条可借鉴的发帖角度（非原文照抄）"],
      "do": ["..."],
      "dont": ["..."],
      "checklist": ["发合约前有预热帖吗？", "发射后还有更新计划吗？"]
    }
  }
}
"""


def _empty_guide_block(summary: str = "") -> dict[str, Any]:
    return {
        "summary": summary,
        "do": [],
        "dont": [],
        "checklist": [],
    }


def _heuristic_guide(token: dict[str, Any], twitter: dict[str, Any] | None) -> dict[str, Any]:
    has_x = bool(token.get("twitter_username"))
    has_site = bool(token.get("website"))
    has_logo = bool(token.get("logo"))
    sym = token.get("symbol") or "TOKEN"

    return {
        "narrative": {
            **_empty_guide_block("启发式：以名字/社交门面粗估，未跑深度 LLM"),
            "one_liner_template": f"「$SYMBOL 是 ____ 的 ____」——先填身份再填情绪",
            "differentiator": "待 LLM / 人工补尖点",
            "do": ["先写一句话身份+口令", "固定 1 个情绪道具（角色/梗）"],
            "dont": ["长文当主叙事", "抄商标/装官方"],
            "checklist": [
                "朋友圈/群里 5 秒说得清买的是啥吗？",
                "只有头像+名字时，别人还能认出你的盘吗？",
                "和同赛道第 N 盘比，多一个尖点了吗？",
            ],
        },
        "visual": {
            **_empty_guide_block(
                "有 logo" if has_logo else "未见 logo，视觉资产可能不足"
            ),
            "character": f"围绕 {sym} 名字定 1 个固定角色",
            "style_keywords": ["高识别", "可做成表情包", "单色或双色主调"],
            "assets": ["头像 1", "主视觉 1", "表情包 3+", "封面图 1"],
            "do": ["角色比例固定，只变换表情/道具", "口令可直接印在图上"],
            "dont": ["多套画风混用", "每张图换一个角色"],
            "checklist": [
                "缩小成头像后还能认出吗？",
                "做成贴纸/表情别人会转吗？",
                "主色不超过 2–3 种吗？",
            ],
        },
        "website": {
            **_empty_guide_block("已有站" if has_site else "无站或未绑定 — 门面缺口"),
            "has_site": has_site,
            "modules": ["首屏口号+主图", "一句话故事", "社交链接", "CA/买入口（如有）"],
            "ia_outline": ["首屏是谁", "为什么现在发", "怎么加入", "链接区"],
            "do": ["单页说清即可", "首屏先给人身份，再给链接"],
            "dont": ["企业介绍长文", "空白占位页"],
            "checklist": [
                "打开站 10 秒知道这是什么币吗？",
                "站上的信息比推特 bio 多吗？",
                "手机一屏内能点到 X/社群吗？",
            ],
        },
        "twitter": {
            **_empty_guide_block(
                f"官方号 @{token.get('twitter_username')}" if has_x else "未绑定 X — 运营证据弱"
            ),
            "persona": "独立项目号（启发式）" if has_x else "缺失",
            "cadence": "需拉推文后再判",
            "content_mix": ["叙事", "梗图", "进度", "互动"] if has_x else [],
            "pre_ca_playbook": ["建号", "先发 ≥5 条预热帖", "再发合约", "发射后按日程更新"],
            "sample_angles": ["自报身份", "预告节奏/事件", "和社区互动提问"],
            "do": ["先养内容再发合约", "语气人设从头到尾一致"],
            "dont": ["裸发合约再补故事", "复制粘贴机器人话术"],
            "checklist": [
                "发合约前是否已有预热帖？",
                "头像/banner/bio 是否同一角色？",
                "发射后是否还有更新计划？",
            ],
        },
    }


def _heuristic(token: dict[str, Any], twitter: dict[str, Any] | None) -> dict[str, Any]:
    """No-LLM fallback using 新盘审视框架 signals."""
    name = f"{token.get('name') or ''} {token.get('symbol') or ''}".strip()
    social_score = 0
    if token.get("twitter_username"):
        social_score += 3
    if token.get("website"):
        social_score += 1
    if token.get("telegram"):
        social_score += 1

    sm = int(token.get("smart_degen_count") or 0)
    kol = int(token.get("renowned_count") or 0)
    rug = float(token.get("rug_ratio") or 0) if token.get("rug_ratio") is not None else None
    top10 = (
        float(token.get("top_10_holder_rate") or 0)
        if token.get("top_10_holder_rate") is not None
        else None
    )
    wash = token.get("is_wash_trading")

    desire = min(10, 4 + social_score + (2 if len(name) <= 24 else 0))
    game = 2
    trust = 6
    risks: list[str] = []
    if rug is not None and rug > 0.3:
        trust -= 3
        risks.append(f"rug_ratio 偏高 ({rug:.2f})")
    if top10 is not None and top10 > 0.5:
        trust -= 2
        risks.append(f"Top10 持仓集中 ({top10:.0%})")
    if wash is True or wash == 1:
        trust -= 3
        risks.append("检测到疑似 wash trading")
    if token.get("creator_token_status") == "creator_hold":
        trust -= 1
        risks.append("dev 仍在持仓 (creator_hold)")
    if sm >= 3:
        trust += 1
    if not risks:
        risks.append("公开信息有限，叙事细节需人工复核")

    bio = ""
    if twitter:
        bio = str(twitter.get("description") or twitter.get("bio") or "")[:200]

    one_liner = bio or f"{token.get('symbol')} — 链上热度驱动的 meme/叙事盘（启发式）"
    narrative = "链上热度 meme"
    track = "流速"
    if re.search(r"ai|agent|gpt", name, re.I):
        narrative = "AI / agent 叙事"
        track = "AI"
    elif re.search(r"cat|dog|pepe|frog|raccoon|bear|bull", name, re.I):
        narrative = "动物 meme"
        track = "动物"
    elif re.search(r"hood|gme|vlad|robin", name, re.I):
        narrative = "券商/本地文化梗"
        track = "本地梗"

    verdict = "仅流速"
    if desire >= 7 and trust >= 6:
        verdict = "值得学结构"
    if trust <= 3:
        verdict = "谨慎"

    return {
        "narrative_type": narrative,
        "track": track,
        "ip_angle": one_liner[:80],
        "one_liner": one_liner,
        "emotional_hook": "热度/涨幅驱动的注意力（启发式，未跑 LLM）",
        "desire": {"score": desire, "note": "基于名字长度与社交链接密度粗估"},
        "game": {"score": game, "note": "榜单数据无法确认真实玩法，默认偏弱"},
        "trust": {"score": max(0, min(10, trust)), "note": f"SM={sm} KOL={kol}"},
        "ip_strength": {
            "memeable": min(10, 5 + (1 if social_score else 0)),
            "ownable": 4,
            "visualizable": 6 if token.get("logo") else 3,
        },
        "why_hot_today": (
            f"24h 榜热度; vol≈{token.get('volume')} mcap≈{token.get('market_cap')} "
            f"chg={token.get('price_change_percent')}%"
        ),
        "risks": risks,
        "lesson_for_builder": "观察其 3 秒锤（名字+图）与社交门面是否齐，勿抄商标/假官方。",
        "copy_vs_create": "可学：门面节奏与一句话结构；必须换：角色/IP/文案皮相",
        "verdict": verdict,
        "confidence": 0.35,
        "guide": _heuristic_guide(token, twitter),
        "source": "heuristic",
    }


def _strip_json(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _ensure_guide(data: dict[str, Any], token: dict[str, Any], twitter: dict | None) -> dict[str, Any]:
    """Merge missing guide blocks with heuristic defaults."""
    base = _heuristic_guide(token, twitter)
    g = data.get("guide")
    if not isinstance(g, dict):
        data["guide"] = base
        return data
    for key in ("narrative", "visual", "website", "twitter"):
        block = g.get(key)
        if not isinstance(block, dict):
            g[key] = base[key]
            continue
        for k, v in base[key].items():
            if k not in block or block[k] in (None, "", []):
                block[k] = v
    data["guide"] = g
    return data


async def analyze_token(
    settings: Settings,
    token: dict[str, Any],
    twitter_profile: dict[str, Any] | None = None,
    tweets: list[dict[str, Any]] | None = None,
    provider: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
) -> dict[str, Any]:
    if not resolve_llm(
        settings, provider, model, api_key_override=api_key, base_url_override=base_url
    ):
        return _heuristic(token, twitter_profile)

    payload = {
        "token": {
            k: token.get(k)
            for k in (
                "chain",
                "address",
                "symbol",
                "name",
                "logo",
                "market_cap",
                "liquidity",
                "volume",
                "price_change_percent",
                "holder_count",
                "smart_degen_count",
                "renowned_count",
                "rug_ratio",
                "top_10_holder_rate",
                "is_wash_trading",
                "creator_token_status",
                "launchpad_platform",
                "twitter_username",
                "website",
                "telegram",
                "age_hours",
            )
        },
        "twitter_profile": twitter_profile,
        "recent_tweets": (tweets or [])[:8],
        "task": "四维指导：叙事选题 / 视觉设计 / 网站 / 推特运营 + 欲局信",
    }

    try:
        content, resolved = await chat_json(
            settings,
            SYSTEM_PROMPT,
            "分析以下热门代币并输出完整 JSON（含 guide 四维）：\n"
            + json.dumps(payload, ensure_ascii=False, default=str),
            provider_override=provider,
            model_override=model,
            api_key_override=api_key,
            base_url_override=base_url,
            temperature=0.4,
        )
        data = json.loads(_strip_json(content))
        if not isinstance(data, dict):
            raise ValueError("LLM returned non-object")
        data = _ensure_guide(data, token, twitter_profile)
        data.setdefault("track", data.get("narrative_type") or "")
        data.setdefault("copy_vs_create", data.get("lesson_for_builder") or "")
        data["source"] = "llm"
        data["provider"] = resolved.provider_id
        data["model"] = resolved.model
        return data
    except Exception as e:
        fallback = _heuristic(token, twitter_profile)
        fallback["llm_error"] = str(e)
        return fallback
