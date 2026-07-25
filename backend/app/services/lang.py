"""UI / LLM language helpers. Frontend locale maps to ``zh`` | ``en``."""

from __future__ import annotations

from typing import Literal

Lang = Literal["zh", "en"]


def normalize_lang(raw: str | None) -> Lang:
    s = (raw or "zh").strip().lower()
    if s in ("en", "en-us", "en_gb", "english", "eng"):
        return "en"
    return "zh"


def disclaimer(lang: Lang) -> str:
    if lang == "en":
        return "For research and education only — not investment advice."
    return "仅供研究与教育，非投资建议"


def output_language_rule(lang: Lang) -> str:
    """Hard instruction appended to every LLM system/user prompt."""
    if lang == "en":
        return (
            "\n\n## OUTPUT LANGUAGE (MANDATORY)\n"
            "- Write **all** analysis, headings, lists, conclusions, and UI copy in **English**.\n"
            "- Original tweet / website text may stay in the source language when quoting; "
            "always add a short English paraphrase after each quote.\n"
            "- Do **not** use Chinese for headings or explanations.\n"
        )
    return (
        "\n\n## 输出语言（强制）\n"
        "- 全文分析、标题、列表、结论均使用**中文**。\n"
        "- 引用推文/网页原文时可保留源语言，并在其后附简短中文释义。\n"
    )


def with_lang(system: str, lang: Lang) -> str:
    return system.rstrip() + output_language_rule(lang)
