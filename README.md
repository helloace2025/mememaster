# MemeMaster

Meme 币选题共创副驾驶 — MVP 第一刀：**三链热门面板 + 叙事/立项分析**。

> 仅供研究与教育，**非投资建议**。

## 已完成（MVP）

信息架构（浅色 · 菜单导航）：

| 路由 | 页面 | 作用 |
|------|------|------|
| `/` | **看板** | GMGN 全链热门 SOL/BSC/Base/ETH/RH（默认首页） |
| `/token/[chain]/[address]` | **分析工作台** | 四维指导（叙事/视觉/网站/推特）+ 评分 + 立项手册 + 共创 |
| `/chat` | **共创对话** | 选题 brainstorm，不负责扫盘 |

- **GMGN**：`sol` / `bsc` / `base` / `eth` / `robinhood` 全链热门榜  
- **6551**：推文抓取 + 运营拆解（`/api/twitter/ops`）  
- **四维 guide**：`/api/analyze` 输出叙事·视觉·网站·推特可执行清单  
- **立项手册**：`/api/playbook` 一键生成完整发币指导 Markdown  
- **LLM**：多厂商；四维指导；自由对话不走死模板  

## 环境变量

复制 `.env.example` → `.env`（已 gitignore）：

| 变量 | 必需 | 说明 |
|------|------|------|
| `GMGN_API_KEY` | 是 | GMGN OpenAPI |
| `OPENNEWS_TOKEN` | 推荐 | 6551 推特 |
| `LLM_PROVIDER` | 可选 | `auto` 或 `deepseek` / `openai` / `google` / `anthropic` / … |
| `DEEPSEEK_API_KEY` 等 | 可选 | 多厂商 Key，有哪个填哪个（见 `.env.example`） |
| `LLM_MODEL` | 可选 | 全局模型覆盖；不填用各厂商默认 |

## 启动

```bash
# 1) 后端（仓库根 .env）
python -m venv .venv
# Windows: .\.venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000

# 2) 前端
cd frontend
cp .env.example .env.local   # NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000
npm install
npm run dev
```

浏览器打开：http://localhost:3000  
API 文档：http://127.0.0.1:8000/docs  

## 生产部署（Railway）

双服务部署说明见 **[RAILWAY.md](./RAILWAY.md)**：

1. **API**：Root Directory = `backend`，配置 `GMGN_API_KEY` / LLM Key / `CORS_ORIGINS`  
2. **Web**：Root Directory = `frontend`，构建时设置 `NEXT_PUBLIC_API_BASE=<API 公网 URL>`

## Skills / MCP

- GMGN skills：`npx skills add GMGNAI/gmgn-skills -y -g`
- OpenTwitter skill：`npx skills add https://github.com/6551Team/opentwitter-mcp --skill opentwitter -y -g`
- Grok MCP（项目级）：`.grok/config.toml` → `twitter` stdio MCP  
  需本机环境变量 `OPENNEWS_TOKEN`，仓库内克隆：`tools/opentwitter-mcp`

## 目录

```
backend/app/          FastAPI + GMGN / 6551 / LLM
frontend/             Next.js 热门面板
tools/opentwitter-mcp 6551 Twitter MCP 源码
```

## 下一步（对齐开发文档）

- M1 入库 + 定时采集 worker  
- 叙事聚类 / 赛道 playbook 沉淀  
- 视觉资产从 logo/推文图做更深拆解  
- 官网 HTML 抓取做落地页对标  
