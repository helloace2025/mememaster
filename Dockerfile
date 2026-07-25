# Unified image: Next.js (public UI) + FastAPI (proxied at /api/*)
# One Railway service → open the domain and see the real website.
FROM node:20-alpine AS fe-deps
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM node:20-alpine AS fe-builder
WORKDIR /fe
COPY --from=fe-deps /fe/node_modules ./node_modules
COPY frontend/ ./
# Same-origin API via Next rewrites → empty base so browser calls /api/*
ENV NEXT_PUBLIC_API_BASE=
ENV UNIFIED_DEPLOY=1
ENV INTERNAL_API_URL=http://127.0.0.1:8001
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM python:3.11-slim AS runner
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    API_PORT=8001 \
    HOSTNAME=0.0.0.0

# Node 20 for Next standalone
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Python API
COPY backend/requirements.txt /app/backend-requirements.txt
RUN pip install --no-cache-dir -r /app/backend-requirements.txt
COPY backend/app /app/api/app

# Next standalone (server.js + node_modules subset)
COPY --from=fe-builder /fe/public /app/web/public
COPY --from=fe-builder /fe/.next/standalone /app/web
COPY --from=fe-builder /fe/.next/static /app/web/.next/static

COPY scripts/start-all.sh /app/start-all.sh
RUN chmod +x /app/start-all.sh

EXPOSE 3000

CMD ["/app/start-all.sh"]
