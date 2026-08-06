from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ROOT / ".env", ROOT / "backend" / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # GMGN OpenAPI
    gmgn_api_key: str = ""
    gmgn_openapi_base: str = "https://openapi.gmgn.ai"
    gmgn_api_base: str = "https://gmgn.ai/defi/quotation/v1"
    gmgn_default_chain: str = "sol"

    # 6551 / OpenNews (Twitter). Railway: set OPENNEWS_TOKEN exactly.
    opennews_token: str = ""
    opennews_api_base: str = "https://ai.6551.io"
    opennews_ws_base: str = "wss://ai.6551.io/open/twitter_wss"

    def model_post_init(self, __context: object) -> None:  # pydantic v2
        # Strip accidental quotes/whitespace from dashboard env pastes
        if self.opennews_token:
            t = self.opennews_token.strip()
            if (t.startswith('"') and t.endswith('"')) or (
                t.startswith("'") and t.endswith("'")
            ):
                t = t[1:-1].strip()
            if t.lower().startswith("bearer "):
                t = t[7:].strip()
            object.__setattr__(self, "opennews_token", t)
        if self.gmgn_api_key:
            object.__setattr__(self, "gmgn_api_key", self.gmgn_api_key.strip())

    dexscreener_api_base: str = "https://api.dexscreener.com"

    # ---------- LLM routing ----------
    # active provider id, or "auto" to pick first configured by priority
    llm_provider: str = "auto"
    # comma-separated fallback / auto order
    llm_provider_priority: str = (
        "deepseek,openai,google,anthropic,qwen,moonshot,zhipu,"
        "siliconflow,doubao,xai,openrouter,groq,minimax,yi,baichuan,custom"
    )
    # optional global model override (wins over per-provider model when set)
    llm_model: str = ""

    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-5.6-luna"
    openai_base_url: str = "https://api.openai.com/v1"  # legacy; provider registry has defaults

    # Anthropic Claude
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5"

    # Google Gemini
    google_api_key: str = ""
    google_model: str = "gemini-3.6-flash"

    # DeepSeek
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-v4-flash"

    # xAI Grok
    xai_api_key: str = ""
    xai_model: str = "grok-4.5"

    # 国产 / 聚合
    moonshot_api_key: str = ""
    moonshot_model: str = "kimi-k2.6"

    qwen_api_key: str = ""  # DashScope API Key
    qwen_model: str = "qwen-plus-latest"

    zhipu_api_key: str = ""
    zhipu_model: str = "glm-4.6"

    siliconflow_api_key: str = ""
    siliconflow_model: str = "deepseek-ai/DeepSeek-V4-Flash"

    doubao_api_key: str = ""  # 火山方舟 ARK_API_KEY
    doubao_model: str = "doubao-seed-1-6-250615"

    minimax_api_key: str = ""
    minimax_model: str = "MiniMax-Text-01"

    baichuan_api_key: str = ""
    baichuan_model: str = "Baichuan4-Turbo"

    yi_api_key: str = ""
    yi_model: str = "yi-lightning"

    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    openrouter_api_key: str = ""
    openrouter_model: str = "deepseek/deepseek-chat"

    mistral_api_key: str = ""
    mistral_model: str = "mistral-small-latest"

    together_api_key: str = ""
    together_model: str = "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo"

    fireworks_api_key: str = ""
    fireworks_model: str = "accounts/fireworks/models/llama-v3p3-70b-instruct"

    perplexity_api_key: str = ""
    perplexity_model: str = "sonar"

    ollama_api_key: str = "ollama"
    ollama_model: str = "llama3.2"

    # 任意 OpenAI 兼容网关
    custom_llm_api_key: str = ""
    custom_llm_base_url: str = ""
    custom_llm_model: str = ""

    # Hot panel defaults
    hot_interval: str = "24h"
    hot_limit_per_chain: int = 20
    # only tokens younger than this (GMGN --max-created). Use "all" for no filter.
    hot_max_created: str = "7d"
    # GMGN market trending supported: sol / bsc / base / eth / robinhood
    hot_chains: str = "sol,bsc,base,eth,robinhood"

    # Comma-separated; use * for any origin (Railway: set to your frontend URL(s))
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    # Public bind port (Railway injects PORT)
    port: int = 8000

    # ---------- OKX x402 (A2MCP paid endpoint) ----------
    # Keep these only in Railway/local environment variables, never in source.
    pay_to_address: str = ""
    okx_api_key: str = ""
    okx_secret_key: str = ""
    okx_passphrase: str = ""
    okx_base_url: str = "https://web3.okx.com"
    x402_price_usd: str = "0.1"
    # Keep the endpoint free by default. Enable only with an explicit Railway
    # environment variable when paid x402 access is intended.
    x402_payment_required: bool = False
    # Keep a paid marketplace call bounded so callers always receive a JSON result.
    agent_response_timeout_seconds: float = 45.0
    agent_market_data_timeout_seconds: float = 12.0

    @property
    def x402_enabled(self) -> bool:
        if not self.x402_payment_required:
            return False
        if not (
            self.pay_to_address
            and self.okx_api_key
            and self.okx_secret_key
            and self.okx_passphrase
        ):
            return False
        try:
            price = Decimal(self.x402_price_usd)
            return price.is_finite() and price > 0
        except InvalidOperation:
            return False

    @property
    def chains(self) -> list[str]:
        return [c.strip() for c in self.hot_chains.split(",") if c.strip()]

    @property
    def llm_api_key(self) -> str:
        """Backward-compatible: True if any provider key is present."""
        from app.services.llm import resolve_llm

        r = resolve_llm(self)
        return r.api_key if r else ""

    @property
    def origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def cors_allow_all(self) -> bool:
        origins = self.origin_list
        return not origins or origins == ["*"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
