"""Fetch and summarize project websites for ops analysis."""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

from app.config import Settings
from app.services.lang import Lang, normalize_lang, with_lang
from app.services.llm import resolve_llm
from app.services.chat import chat_text

WEBSITE_SYSTEM_ZH = """你是 meme 项目「官网 / 落地页」运营拆解教练。
基于真实抓取的页面摘要（标题、meta、可见文案、链接、技术线索），分析这个站是怎么为项目服务的。

用中文 Markdown 输出（不要 JSON），结构固定：

## 1. 站点定位
## 2. 信息架构与首屏
## 3. 设计与视觉
## 4. 功能与转化
## 5. 技术栈线索
## 6. 可学点 / 勿抄点

原则：信息不足就标明；研究教育，非投资建议。正常换行，不要字面 \\n。
"""

WEBSITE_SYSTEM_EN = """You are a meme project coach for **website / landing page** teardown.
Use the real page summary (title, meta, visible copy, links, tech hints).

Write **English** Markdown (not JSON):

## 1. Site role
## 2. IA & first screen
## 3. Design & visuals
## 4. Features & conversion
## 5. Tech stack clues
## 6. What to learn / what not to copy

Research only — not investment advice. Real newlines; no literal \\n.
"""


def website_system(lang: Lang) -> str:
    return with_lang(WEBSITE_SYSTEM_EN if lang == "en" else WEBSITE_SYSTEM_ZH, lang)


WEBSITE_SYSTEM = WEBSITE_SYSTEM_ZH


_TECH_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Next.js", re.compile(r"/_next/|__NEXT_DATA__|next/dist", re.I)),
    ("React", re.compile(r"react(?:-dom)?(?:\.production|\.min)?\.js|data-reactroot", re.I)),
    ("Vue", re.compile(r"vue(?:\.runtime)?(?:\.min)?\.js|data-v-[a-f0-9]", re.I)),
    ("Nuxt", re.compile(r"__NUXT__|/_nuxt/", re.I)),
    ("Svelte", re.compile(r"svelte|__svelte", re.I)),
    ("WordPress", re.compile(r"wp-content|wp-includes", re.I)),
    ("Webflow", re.compile(r"webflow", re.I)),
    ("Framer", re.compile(r"framer\.com|framerusercontent", re.I)),
    ("Squarespace", re.compile(r"squarespace", re.I)),
    ("Carrd", re.compile(r"carrd\.co", re.I)),
    ("GitHub Pages", re.compile(r"github\.io", re.I)),
    ("Vercel", re.compile(r"vercel\.app|x-vercel", re.I)),
    ("Cloudflare", re.compile(r"cloudflare|cf-ray|cdn-cgi", re.I)),
    ("Tailwind", re.compile(r"tailwind|class=\"[^\"]*(?:flex|grid|text-sm|bg-zinc)", re.I)),
    ("Bootstrap", re.compile(r"bootstrap(?:\.min)?\.css", re.I)),
    ("Google Analytics", re.compile(r"googletagmanager|gtag\(|google-analytics", re.I)),
    ("WalletConnect / Web3", re.compile(r"walletconnect|ethers\.js|web3\.js|wagmi", re.I)),
]


def _normalize_url(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return ""
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u
    return u


def _meta_content(html: str, *names: str) -> str:
    for name in names:
        m = re.search(
            rf'<meta[^>]+(?:name|property)=["\']{re.escape(name)}["\'][^>]+content=["\']([^"\']*)["\']',
            html,
            re.I,
        )
        if not m:
            m = re.search(
                rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]+(?:name|property)=["\']{re.escape(name)}["\']',
                html,
                re.I,
            )
        if m:
            return m.group(1).strip()
    return ""


def _strip_tags(html: str) -> str:
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html)
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    text = re.sub(r"(?is)<noscript[^>]*>.*?</noscript>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;|&amp;|&lt;|&gt;|&quot;", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _extract_links(html: str, base: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.I | re.S):
        href = m.group(1).strip()
        label = re.sub(r"<[^>]+>", "", m.group(2)).strip()[:80]
        if not href or href.startswith(("#", "javascript:", "mailto:")):
            continue
        abs_url = urljoin(base, href)
        key = abs_url.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({"href": abs_url[:300], "label": label})
        if len(out) >= 40:
            break
    return out


def _detect_tech(html: str, headers: dict[str, str], final_url: str) -> list[str]:
    blob = html + "\n" + "\n".join(f"{k}:{v}" for k, v in headers.items()) + "\n" + final_url
    found: list[str] = []
    for name, pat in _TECH_PATTERNS:
        if pat.search(blob):
            found.append(name)
    return found


def summarize_html(html: str, final_url: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
    headers = headers or {}
    title_m = re.search(r"(?is)<title[^>]*>(.*?)</title>", html)
    title = re.sub(r"\s+", " ", title_m.group(1)).strip() if title_m else ""
    desc = _meta_content(html, "description", "og:description", "twitter:description")
    og_title = _meta_content(html, "og:title", "twitter:title")
    og_image = _meta_content(html, "og:image", "twitter:image")
    visible = _strip_tags(html)[:4000]
    links = _extract_links(html, final_url)
    tech = _detect_tech(html, headers, final_url)

    social_hosts = ("x.com", "twitter.com", "t.me", "telegram", "discord", "github.com")
    social_links = [
        L
        for L in links
        if any(h in L["href"].lower() for h in social_hosts)
    ]

    return {
        "final_url": final_url,
        "title": title or og_title,
        "description": desc,
        "og_image": og_image,
        "visible_text_excerpt": visible,
        "links": links[:25],
        "social_links": social_links[:15],
        "tech_hints": tech,
        "html_bytes": len(html.encode("utf-8", errors="ignore")),
    }


async def fetch_website(url: str, timeout: float = 12.0) -> dict[str, Any]:
    url = _normalize_url(url)
    if not url:
        return {"ok": False, "error": "empty url", "url": url}

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return {"ok": False, "error": "invalid url", "url": url}

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=timeout,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (compatible; MemeMasterBot/0.1; +research)"
                ),
                "Accept": "text/html,application/xhtml+xml",
            },
        ) as client:
            resp = await client.get(url)
            ctype = (resp.headers.get("content-type") or "").lower()
            if "html" not in ctype and "text/" not in ctype and not resp.text[:200].lstrip().lower().startswith("<!"):
                return {
                    "ok": False,
                    "error": f"非 HTML 响应 content-type={ctype or 'unknown'}",
                    "url": url,
                    "status_code": resp.status_code,
                    "final_url": str(resp.url),
                }
            html = resp.text[:250_000]
            summary = summarize_html(
                html,
                str(resp.url),
                {k: v for k, v in resp.headers.items()},
            )
            return {
                "ok": True,
                "url": url,
                "status_code": resp.status_code,
                **summary,
            }
    except httpx.TimeoutException:
        return {"ok": False, "error": "timeout", "url": url}
    except httpx.HTTPError:
        return {"ok": False, "error": "network", "url": url}
    except Exception:
        return {"ok": False, "error": "fetch_failed", "url": url}


async def analyze_website(
    settings: Settings,
    *,
    url: str,
    token: dict[str, Any] | None = None,
    provider: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    lang: str | None = None,
) -> dict[str, Any]:
    L = normalize_lang(lang)
    fetched = await fetch_website(url)
    if not fetched.get("ok"):
        code = str(fetched.get("error") or "fetch_failed")
        if L == "en":
            human = {
                "timeout": "Request timed out",
                "network": "Network error",
                "fetch_failed": "Could not load the page",
            }.get(code, "Could not load the page")
            content = (
                f"{human}.\n\n"
                f"URL: {url}\n"
                "Possible causes: downtime, bot protection, client-only render, or a bad link."
            )
        else:
            human = {
                "timeout": "请求超时",
                "network": "网络错误",
                "fetch_failed": "无法打开网站",
            }.get(code, "无法打开网站")
            content = (
                f"{human}。\n\n"
                f"URL：{url}\n"
                "可能原因：站点宕机、防爬、仅客户端渲染、或链接无效。"
            )
        return {
            "ok": False,
            "url": url,
            "content": content,
            "fetch": fetched,
            "source": "website_fetch_error",
        }

    if not resolve_llm(
        settings, provider, model, api_key_override=api_key, base_url_override=base_url
    ):
        # still return raw summary without LLM
        tech = ", ".join(fetched.get("tech_hints") or []) or (
            "unknown" if L == "en" else "未识别"
        )
        if L == "en":
            content = (
                f"## Site fetch summary (no LLM configured)\n\n"
                f"- URL: {fetched.get('final_url')}\n"
                f"- Title: {fetched.get('title') or '—'}\n"
                f"- Description: {fetched.get('description') or '—'}\n"
                f"- Tech hints: {tech}\n"
                f"- Visible text excerpt:\n\n{(fetched.get('visible_text_excerpt') or '')[:1200]}\n"
            )
        else:
            content = (
                f"## 站点抓取摘要（未配置 LLM，仅原始观察）\n\n"
                f"- URL：{fetched.get('final_url')}\n"
                f"- 标题：{fetched.get('title') or '—'}\n"
                f"- 描述：{fetched.get('description') or '—'}\n"
                f"- 技术线索：{tech}\n"
                f"- 可见文案摘录：\n\n{(fetched.get('visible_text_excerpt') or '')[:1200]}\n"
            )
        return {
            "ok": True,
            "url": url,
            "content": content,
            "fetch": fetched,
            "source": "website_raw",
        }

    payload = {
        "lang": L,
        "token": {
            "symbol": (token or {}).get("symbol"),
            "name": (token or {}).get("name"),
            "chain": (token or {}).get("chain"),
            "website": (token or {}).get("website"),
        },
        "page": {
            "final_url": fetched.get("final_url"),
            "title": fetched.get("title"),
            "description": fetched.get("description"),
            "og_image": fetched.get("og_image"),
            "tech_hints": fetched.get("tech_hints"),
            "social_links": fetched.get("social_links"),
            "links": fetched.get("links"),
            "visible_text_excerpt": (fetched.get("visible_text_excerpt") or "")[:3000],
        },
    }
    if L == "en":
        prompt = (
            "Using this real website fetch, write a landing-page ops teardown in English:\n"
            + json.dumps(payload, ensure_ascii=False, default=str)[:18000]
        )
    else:
        prompt = (
            "请基于以下真实抓取的官网数据做落地页运营拆解：\n"
            + json.dumps(payload, ensure_ascii=False, default=str)[:18000]
        )
    content, resolved = await chat_text(
        settings,
        website_system(L),
        prompt,
        provider=provider,
        model=model,
        api_key=api_key,
        base_url=base_url,
        temperature=0.35,
    )
    return {
        "ok": True,
        "url": url,
        "final_url": fetched.get("final_url"),
        "content": content,
        "fetch": {
            "title": fetched.get("title"),
            "tech_hints": fetched.get("tech_hints"),
            "social_links": fetched.get("social_links"),
            "status_code": fetched.get("status_code"),
        },
        "provider": resolved.provider_id,
        "model": resolved.model,
        "source": "website_ops",
    }
