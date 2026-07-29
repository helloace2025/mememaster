"""Multi-provider LLM router (OpenAI-compatible + Claude/Anthropic).

Fill any provider keys in `.env`; set `LLM_PROVIDER` to choose the active one.
Missing keys are ignored — only the selected (or auto-detected) provider is used.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from openai import AsyncOpenAI

from app.config import Settings


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    label: str
    base_url: str
    default_model: str
    # Settings attribute names for key / optional model override
    key_attr: str
    model_attr: str
    # openai | anthropic
    api_style: str = "openai"
    notes: str = ""


# Recommended models per provider (UI catalog). First item is the economical default.
# Catalog refreshed ~2026-07. Users can still type a custom model id not in this list.
# Prefer current flagship IDs; mark sunset models as legacy only when still briefly usable.
MODEL_LISTS: dict[str, list[dict[str, str]]] = {
    "deepseek": [
        {"id": "deepseek-v4-flash", "label": "V4 Flash（推荐·经济）", "tier": "economy"},
        {"id": "deepseek-v4-pro", "label": "V4 Pro（旗舰）", "tier": "premium"},
    ],
}
# Registry of supported providers. Keys are env-driven; only filled ones are "ready".
PROVIDER_SPECS: dict[str, ProviderSpec] = {
    "openai": ProviderSpec(
        id="openai",
        label="OpenAI",
        base_url="https://api.openai.com/v1",
        default_model="gpt-5.6-luna",
        key_attr="openai_api_key",
        model_attr="openai_model",
        notes="首选 GPT-5.6 系列（Luna/Terra/Sol）；旧 4o 将逐步下线",
    ),
    "anthropic": ProviderSpec(
        id="anthropic",
        label="Anthropic Claude",
        base_url="https://api.anthropic.com",
        default_model="claude-sonnet-5",
        key_attr="anthropic_api_key",
        model_attr="anthropic_model",
        api_style="anthropic",
        notes="Messages API；推荐 Sonnet 5 / Opus 5 / Haiku 4.5",
    ),
    "google": ProviderSpec(
        id="google",
        label="Google Gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        default_model="gemini-3.6-flash",
        key_attr="google_api_key",
        model_attr="google_model",
        notes="Gemini OpenAI 兼容端点；2.0 已下线，优先 3.x",
    ),
    "deepseek": ProviderSpec(
        id="deepseek",
        label="DeepSeek",
        base_url="https://api.deepseek.com",
        default_model="deepseek-v4-flash",
        key_attr="deepseek_api_key",
        model_attr="deepseek_model",
        notes="经济首选 deepseek-v4-flash；chat/reasoner 将于 2026-07-24 下线",
    ),
    "xai": ProviderSpec(
        id="xai",
        label="xAI Grok",
        base_url="https://api.x.ai/v1",
        default_model="grok-4.5",
        key_attr="xai_api_key",
        model_attr="xai_model",
        notes="旗舰 grok-4.5；Grok 3 系列已属旧代",
    ),
    "moonshot": ProviderSpec(
        id="moonshot",
        label="Moonshot 月之暗面 Kimi",
        base_url="https://api.moonshot.cn/v1",
        default_model="kimi-k2.6",
        key_attr="moonshot_api_key",
        model_attr="moonshot_model",
        notes="优先 kimi-k2.6 / kimi-k3；moonshot-v1 系列将下线",
    ),
    "qwen": ProviderSpec(
        id="qwen",
        label="通义千问 Qwen (DashScope)",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        default_model="qwen-plus-latest",
        key_attr="qwen_api_key",
        model_attr="qwen_model",
        notes="阿里云 DashScope 兼容模式；优先 *-latest / Qwen3",
    ),
    "zhipu": ProviderSpec(
        id="zhipu",
        label="智谱 GLM",
        base_url="https://open.bigmodel.cn/api/paas/v4/",
        default_model="glm-4.6",
        key_attr="zhipu_api_key",
        model_attr="zhipu_model",
        notes="优先 GLM-4.6 / 4.7 / 5.1；旧 glm-4-flash 仅兼容",
    ),
    "siliconflow": ProviderSpec(
        id="siliconflow",
        label="SiliconFlow 硅基流动",
        base_url="https://api.siliconflow.cn/v1",
        default_model="deepseek-ai/DeepSeek-V4-Flash",
        key_attr="siliconflow_api_key",
        model_attr="siliconflow_model",
        notes="可聚合多家开源模型；以控制台实际上架名为准",
    ),
    "doubao": ProviderSpec(
        id="doubao",
        label="豆包 / 火山方舟",
        base_url="https://ark.cn-beijing.volces.com/api/v3",
        default_model="doubao-seed-1-6-250615",
        key_attr="doubao_api_key",
        model_attr="doubao_model",
        notes="方舟以接入点 endpoint id 为准，列表仅为示例",
    ),
    "minimax": ProviderSpec(
        id="minimax",
        label="MiniMax",
        base_url="https://api.minimax.chat/v1",
        default_model="MiniMax-Text-01",
        key_attr="minimax_api_key",
        model_attr="minimax_model",
    ),
    "baichuan": ProviderSpec(
        id="baichuan",
        label="百川 Baichuan",
        base_url="https://api.baichuan-ai.com/v1",
        default_model="Baichuan4-Turbo",
        key_attr="baichuan_api_key",
        model_attr="baichuan_model",
    ),
    "yi": ProviderSpec(
        id="yi",
        label="零一万物 Yi",
        base_url="https://api.lingyiwanwu.com/v1",
        default_model="yi-lightning",
        key_attr="yi_api_key",
        model_attr="yi_model",
    ),
    "groq": ProviderSpec(
        id="groq",
        label="Groq",
        base_url="https://api.groq.com/openai/v1",
        default_model="llama-3.3-70b-versatile",
        key_attr="groq_api_key",
        model_attr="groq_model",
    ),
    "openrouter": ProviderSpec(
        id="openrouter",
        label="OpenRouter",
        base_url="https://openrouter.ai/api/v1",
        default_model="deepseek/deepseek-chat",
        key_attr="openrouter_api_key",
        model_attr="openrouter_model",
        notes="一站式多模型路由",
    ),
    "mistral": ProviderSpec(
        id="mistral",
        label="Mistral AI",
        base_url="https://api.mistral.ai/v1",
        default_model="mistral-small-latest",
        key_attr="mistral_api_key",
        model_attr="mistral_model",
    ),
    "together": ProviderSpec(
        id="together",
        label="Together AI",
        base_url="https://api.together.xyz/v1",
        default_model="meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
        key_attr="together_api_key",
        model_attr="together_model",
    ),
    "fireworks": ProviderSpec(
        id="fireworks",
        label="Fireworks AI",
        base_url="https://api.fireworks.ai/inference/v1",
        default_model="accounts/fireworks/models/llama-v3p3-70b-instruct",
        key_attr="fireworks_api_key",
        model_attr="fireworks_model",
    ),
    "perplexity": ProviderSpec(
        id="perplexity",
        label="Perplexity",
        base_url="https://api.perplexity.ai",
        default_model="sonar",
        key_attr="perplexity_api_key",
        model_attr="perplexity_model",
    ),
    "ollama": ProviderSpec(
        id="ollama",
        label="Ollama（本地）",
        base_url="http://127.0.0.1:11434/v1",
        default_model="llama3.2",
        key_attr="ollama_api_key",
        model_attr="ollama_model",
        notes="本地 Ollama；Key 可填 ollama 任意字符",
    ),
    "custom": ProviderSpec(
        id="custom",
        label="自定义 OpenAI 兼容",
        base_url="",  # filled from settings / client base_url
        default_model="custom-model",
        key_attr="custom_llm_api_key",
        model_attr="custom_llm_model",
        notes="任意兼容网关：Base URL + API Key + Model",
    ),
}


@dataclass
class ResolvedLLM:
    provider_id: str
    label: str
    model: str
    api_style: str
    api_key: str
    base_url: str


def _get_attr(settings: Settings, name: str) -> str:
    return (getattr(settings, name, None) or "").strip()


def provider_status(settings: Settings) -> list[dict[str, Any]]:
    """List all providers and whether a key is configured, plus model catalog.

    Always returns every registered vendor so the UI can let users paste their own keys.
    """
    rows = []
    for pid, spec in PROVIDER_SPECS.items():
        key = _get_attr(settings, spec.key_attr)
        default_model = _get_attr(settings, spec.model_attr) or spec.default_model
        base = spec.base_url
        if pid == "custom":
            base = _get_attr(settings, "custom_llm_base_url") or base
        if pid == "ollama" and not base:
            base = "http://127.0.0.1:11434/v1"
        catalog = list(MODEL_LISTS.get(pid, []))
        if default_model and not any(m["id"] == default_model for m in catalog):
            catalog = [
                {"id": default_model, "label": f"{default_model}（默认）", "tier": "default"},
                *catalog,
            ]
        env_ok = bool(key) and (pid not in ("custom",) or bool(base))
        if pid == "ollama":
            env_ok = True  # local default, key optional
        rows.append(
            {
                "id": pid,
                "label": spec.label,
                "configured": env_ok,
                "env_configured": env_ok,
                "default_model": default_model,
                "model": default_model,
                "models": catalog,
                "base_url": base,
                "api_style": spec.api_style,
                "notes": spec.notes,
                # UI always allows client-side key even if env empty
                "needs_key": pid != "ollama",
                "needs_base_url": pid in ("custom", "ollama", "azure"),
            }
        )
    return rows


def resolve_llm(
    settings: Settings,
    provider_override: str | None = None,
    model_override: str | None = None,
    api_key_override: str | None = None,
    base_url_override: str | None = None,
) -> ResolvedLLM | None:
    """Pick active provider + model.

    Client may pass api_key / base_url (browser localStorage) to use without .env.
    Priority for provider: override → LLM_PROVIDER → first configured by priority.
    Priority for model: request override → LLM_MODEL env → provider *_MODEL → default.
    """
    preferred = (provider_override or settings.llm_provider or "").strip().lower()
    key_ov = (api_key_override or "").strip()
    base_ov = (base_url_override or "").strip()

    priority = [
        p.strip().lower()
        for p in (settings.llm_provider_priority or "").split(",")
        if p.strip()
    ]
    if not priority:
        priority = [
            "deepseek",
            "openai",
            "google",
            "anthropic",
            "qwen",
            "moonshot",
            "zhipu",
            "siliconflow",
            "doubao",
            "xai",
            "mistral",
            "openrouter",
            "groq",
            "together",
            "fireworks",
            "perplexity",
            "minimax",
            "yi",
            "baichuan",
            "ollama",
            "custom",
        ]

    # Direct path: user picked a vendor + pasted a key (or ollama without key)
    if preferred and preferred != "auto":
        spec = PROVIDER_SPECS.get(preferred)
        if preferred == "custom" or (spec is None and base_ov and key_ov):
            base = base_ov or (
                _get_attr(settings, "custom_llm_base_url") if preferred == "custom" else ""
            )
            key = key_ov or _get_attr(settings, "custom_llm_api_key")
            model = (
                (model_override or "").strip()
                or _get_attr(settings, "custom_llm_model")
                or "gpt-4o-mini"
            )
            if key and base:
                return ResolvedLLM(
                    provider_id="custom",
                    label=spec.label if spec else "Custom",
                    model=model,
                    api_style="openai",
                    api_key=key,
                    base_url=base.rstrip("/"),
                )
        elif spec:
            key = key_ov or _get_attr(settings, spec.key_attr)
            if preferred == "ollama" and not key:
                key = "ollama"
            base = base_ov or spec.base_url
            if preferred == "custom":
                base = base_ov or _get_attr(settings, "custom_llm_base_url")
            if preferred == "ollama" and not base:
                base = "http://127.0.0.1:11434/v1"
            model = (
                (model_override or "").strip()
                or _get_attr(settings, "llm_model")
                or _get_attr(settings, spec.model_attr)
                or spec.default_model
            )
            if key and base:
                return ResolvedLLM(
                    provider_id=preferred,
                    label=spec.label,
                    model=model,
                    api_style=spec.api_style,
                    api_key=key,
                    base_url=base.rstrip("/"),
                )

    candidates: list[str] = []
    if preferred and preferred != "auto":
        candidates.append(preferred)
    candidates.extend([p for p in priority if p not in candidates])
    for pid in PROVIDER_SPECS:
        if pid not in candidates:
            candidates.append(pid)

    for pid in candidates:
        spec = PROVIDER_SPECS.get(pid)
        if not spec:
            continue
        key = key_ov if (key_ov and (not preferred or preferred in ("auto", pid))) else ""
        if not key:
            key = _get_attr(settings, spec.key_attr)
        if pid == "ollama" and not key:
            key = "ollama"
        if not key:
            continue
        base = base_ov if (base_ov and pid in (preferred, "custom", "ollama")) else ""
        if not base:
            base = spec.base_url
        if pid == "custom":
            base = base_ov or _get_attr(settings, "custom_llm_base_url")
            if not base:
                continue
        if pid == "ollama" and not base:
            base = "http://127.0.0.1:11434/v1"

        model = (
            (model_override or "").strip()
            or _get_attr(settings, "llm_model")
            or _get_attr(settings, spec.model_attr)
            or spec.default_model
        )
        if not model:
            model = spec.default_model
        return ResolvedLLM(
            provider_id=pid,
            label=spec.label,
            model=model,
            api_style=spec.api_style,
            api_key=key,
            base_url=base.rstrip("/"),
        )
    return None


def openai_client(resolved: ResolvedLLM) -> AsyncOpenAI:
    return AsyncOpenAI(api_key=resolved.api_key, base_url=resolved.base_url)


async def chat_json(
    settings: Settings,
    system: str,
    user: str,
    *,
    provider_override: str | None = None,
    model_override: str | None = None,
    api_key_override: str | None = None,
    base_url_override: str | None = None,
    temperature: float = 0.4,
) -> tuple[str, ResolvedLLM]:
    """Run a chat completion expecting JSON text. Returns (content, resolved)."""
    resolved = resolve_llm(
        settings,
        provider_override,
        model_override,
        api_key_override=api_key_override,
        base_url_override=base_url_override,
    )
    if not resolved:
        raise RuntimeError("No LLM provider configured — 请在界面填写 API Key 或配置 .env")

    if resolved.api_style == "anthropic":
        content = await _anthropic_json(resolved, system, user, temperature)
        return content, resolved

    client = openai_client(resolved)
    kwargs: dict[str, Any] = {
        "model": resolved.model,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    # response_format is widely supported but not universal — try, then retry without
    try:
        resp = await client.chat.completions.create(
            **kwargs,
            response_format={"type": "json_object"},
        )
    except Exception:
        resp = await client.chat.completions.create(**kwargs)

    content = resp.choices[0].message.content or "{}"
    return content, resolved


async def _anthropic_json(
    resolved: ResolvedLLM,
    system: str,
    user: str,
    temperature: float,
) -> str:
    import httpx

    url = f"{resolved.base_url}/v1/messages"
    headers = {
        "x-api-key": resolved.api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body = {
        "model": resolved.model,
        "max_tokens": 4096,
        "temperature": temperature,
        "system": system + "\n\n请只输出合法 JSON，不要 markdown 代码块。",
        "messages": [{"role": "user", "content": user}],
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        res = await client.post(url, headers=headers, json=body)
    if res.status_code >= 400:
        raise RuntimeError(f"Anthropic HTTP {res.status_code}: {res.text[:400]}")
    data = res.json()
    parts = data.get("content") or []
    texts = [p.get("text", "") for p in parts if isinstance(p, dict) and p.get("type") == "text"]
    return "\n".join(texts) or "{}"
