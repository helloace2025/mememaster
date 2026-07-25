# Deploy MemeMaster on Railway

Monorepo: **two Railway services** from the same GitHub repo.

```
GitHub: helloace2025/mememaster
  ├─ backend/   → Service "mememaster-api"
  └─ frontend/  → Service "mememaster-web"
```

## 1) API service

1. New Project → Deploy from GitHub → this repo  
2. **Settings → Root Directory** = `backend`  
3. Variables (minimum):

| Variable | Example |
|----------|---------|
| `GMGN_API_KEY` | your key |
| `OPENNEWS_TOKEN` | optional, for X ops |
| `DEEPSEEK_API_KEY` | or any LLM key |
| `LLM_PROVIDER` | `auto` or `deepseek` |
| `CORS_ORIGINS` | `*` first, later lock to FE URL |

4. Generate domain → note URL, e.g. `https://mememaster-api-production.up.railway.app`  
5. Health: `GET /api/health` should return `"ok": true`

Start command (auto via `backend/railway.toml`):

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

## 2) Web service

1. Same project → **Add service** → same repo  
2. **Root Directory** = `frontend`  
3. Variables:

| Variable | When | Value |
|----------|------|--------|
| `NEXT_PUBLIC_API_BASE` | **Build + Runtime** | `https://your-api.up.railway.app` (no trailing slash) |

> `NEXT_PUBLIC_*` is baked in at **build** time. Set it **before** first deploy, or **Redeploy** after changing it.

4. Generate domain for the web service.

## 3) Lock CORS (recommended)

After both URLs exist:

```text
CORS_ORIGINS=https://your-frontend.up.railway.app
```

(on the API service; restart)

## 4) Local smoke before deploy

```bash
# API
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Web
cd frontend
cp .env.example .env.local   # NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000
npm ci
npm run build && npm start
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| FE calls localhost:8000 in browser | `NEXT_PUBLIC_API_BASE` missing at **build**; set + Redeploy FE |
| CORS errors | Set API `CORS_ORIGINS` to FE origin or `*` |
| API 502 | Check `GMGN_API_KEY` / logs; open `/api/health` |
| Build OOM on FE | Railway plan memory; or use Dockerfiles in `frontend/` / `backend/` |

## Optional: Docker

- API: `docker build -t mm-api ./backend`  
- Web: `docker build --build-arg NEXT_PUBLIC_API_BASE=https://api.example.com -t mm-web ./frontend`
