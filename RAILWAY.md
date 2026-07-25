# Deploy MemeMaster on Railway

## What you had before

`https://mememaster-production.up.railway.app` was **only the FastAPI API**:

- `/api/health` → JSON OK  
- `/` → **404 empty** (no Next.js UI)

## Current setup (recommended): **one service = full website**

Root `Dockerfile` runs:

1. FastAPI on `127.0.0.1:8001`  
2. Next.js on public `$PORT`  
3. Browser calls **same origin** `/api/*` (Next rewrites to the API)

### Steps

1. One Railway service from GitHub `helloace2025/mememaster`  
2. Root Directory: **empty** (repo root)  
3. Variables:

| Variable | Example |
|----------|---------|
| `GMGN_API_KEY` | required for hot list |
| `DEEPSEEK_API_KEY` | or other LLM key |
| `LLM_PROVIDER` | `auto` |
| `CORS_ORIGINS` | `*` or your Railway domain |
| `OPENNEWS_TOKEN` | required for 推文/运营拆解（6551，[领取](http://app.newsliquid.com/mcp)） |

4. Redeploy → open `https://your-app.up.railway.app/` — you should see the **看板 UI**, not a blank 404.

5. Health: `https://your-app.up.railway.app/api/health`

> Do **not** set `NEXT_PUBLIC_API_BASE` for the unified image (build already uses same-origin).

---

## Optional: two services (API + Web)

Only if you want them split.

| Service | Root Directory | Notes |
|---------|----------------|--------|
| API | `backend` | needs keys above |
| Web | `frontend` | set `NEXT_PUBLIC_API_BASE=https://api-host` at **build** |

---

## Troubleshooting

| Symptom | Cause |
|---------|--------|
| Domain opens blank / 404 JSON | Still running **API-only** image — redeploy latest unified Dockerfile |
| Hot list empty (`/api/hot` count=0) | See below |
| LLM not working | Missing LLM API keys (`DEEPSEEK_API_KEY` etc.) |
| Build timeout | Free tier memory; retry or upgrade |

### Hot list empty but `/api/health` shows `gmgn_key: true`

1. Redeploy **latest** image (includes `gmgn-cli` + IPv4 fix).  
2. Check health has **`gmgn_cli: true`** (CLI installed in container).  
3. Confirm Railway variable name is exactly **`GMGN_API_KEY`** (not a custom name).  
4. Start logs should show: `GMGN_API_KEY present` and `gmgn-cli: …`.  
5. Probe: `/api/hot?chains=sol&limit=5&max_created=all` — should return tokens.  
6. GMGN OpenAPI needs **IPv4**; the image forces IPv4 (same as official `gmgn-cli`).

### 推文抓不到

**不要**在 Railway 容器里 `npx skills add opentwitter`。  
`opentwitter` skill 只给本机 AI Agent 用；线上 MemeMaster 已内置同等 REST 调用（`POST https://ai.6551.io/open/twitter_*`）。

1. Railway 变量 **`OPENNEWS_TOKEN`** 已配置（`/api/health` → `opennews_token: true`）  
2. 代币必须有真实 `@handle`（Community 链接 / status 链接会标 dead 并跳过）  
3. 自测：`POST /api/twitter/ops` body `{"username":"elonmusk","max_tweets":3}` 应返回 `tweet_count > 0`
