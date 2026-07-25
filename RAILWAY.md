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
| `OPENNEWS_TOKEN` | optional (Twitter ops) |

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
| Hot list empty | Missing `GMGN_API_KEY` |
| LLM not working | Missing LLM API keys (`DEEPSEEK_API_KEY` etc.) |
| Build timeout | Free tier memory; retry or upgrade |
