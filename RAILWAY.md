# Deploy MemeMaster on Railway

## Why the first deploy failed

Screenshot symptoms:

- **Failed to build an image** (≈7s)
- **0 Variables**
- Single service from repo root (`mememaster-production…`)

This is a **monorepo** (`backend/` + `frontend/`). If Railway uses the **repo root** without a root `Dockerfile`, Nixpacks cannot pick one app → **image build fails**.

We now ship a **root `Dockerfile`** that builds the **API**. The web app still needs a **second service**.

---

## Recommended setup (2 services)

### Service A — API（先部署这个）

| Setting | Value |
|---------|--------|
| Source | GitHub `helloace2025/mememaster` |
| Root Directory | leave empty **or** `backend` |
| Builder | Dockerfile (root `Dockerfile` or `backend/Dockerfile`) |

**Variables（必须加，截图里是 0 Variables）：**

| Variable | Example |
|----------|---------|
| `GMGN_API_KEY` | your key |
| `DEEPSEEK_API_KEY` | or other LLM key |
| `LLM_PROVIDER` | `auto` |
| `CORS_ORIGINS` | `*` （先这样，后面改成前端域名） |
| `OPENNEWS_TOKEN` | optional |

Generate domain → open:

`https://<api-host>/api/health` → should show `"ok": true`

---

### Service B — Web（同一 Project → New Service → 同一仓库）

| Setting | Value |
|---------|--------|
| Root Directory | **`frontend`** （必填） |
| Builder | Dockerfile |

**Variables：**

| Variable | Scope | Value |
|----------|--------|--------|
| `NEXT_PUBLIC_API_BASE` | **Build + Runtime** | `https://<api-host>` （无尾斜杠） |

> 改了 `NEXT_PUBLIC_API_BASE` 必须 **Redeploy** 前端（变量打进 JS 包）。

Generate domain for the web service → that is the user-facing URL.

---

## After both are up

On **API** service, set:

```text
CORS_ORIGINS=https://your-frontend.up.railway.app
```

---

## Checklist if build still fails

1. Open **Build Logs**（不只看 Details）  
2. Confirm Dockerfile is used (not random Nixpacks at empty monorepo root)  
3. API service has at least the env vars above  
4. Web service Root Directory is exactly `frontend`  
5. Web has `NEXT_PUBLIC_API_BASE` pointing at the API public URL  

---

## Local smoke

```bash
# API
pip install -r backend/requirements.txt
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000

# Web
cd frontend
echo NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000 > .env.local
npm ci && npm run build && npm start
```
