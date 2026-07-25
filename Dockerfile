# Unified: Next.js UI (public PORT) + FastAPI (127.0.0.1:8001, proxied via /api/*)
# Base = Node image (reliable Next standalone) + Python venv for API.

# ─── Frontend deps ───────────────────────────────────────────
FROM node:20-bookworm-slim AS fe-deps
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# ─── Frontend build ──────────────────────────────────────────
FROM node:20-bookworm-slim AS fe-builder
WORKDIR /fe
COPY --from=fe-deps /fe/node_modules ./node_modules
COPY frontend/ ./

# Same-origin /api/* in the browser (Next rewrites → internal API)
ENV NEXT_PUBLIC_API_BASE=
ENV UNIFIED_DEPLOY=1
ENV INTERNAL_API_URL=http://127.0.0.1:8001
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build \
  && ls -la .next/standalone \
  && (test -f .next/standalone/server.js || test -f .next/standalone/frontend/server.js)

# ─── Runtime ─────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    API_PORT=8001 \
    HOSTNAME=0.0.0.0 \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv \
    && pip install --no-cache-dir -U pip \
    && npm install -g gmgn-cli@1.5.2 \
    && gmgn-cli --version

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt

# API package: /app/api/app/main.py
COPY backend/app /app/api/app

# Next standalone (+ static + public)
# Support both flat and nested (package name) standalone layouts
COPY --from=fe-builder /fe/.next/standalone /app/web
COPY --from=fe-builder /fe/.next/static /app/web/.next/static
COPY --from=fe-builder /fe/public /app/web/public
# If standalone nested under frontend/, also place static there
COPY --from=fe-builder /fe/.next/static /app/web/frontend/.next/static
COPY --from=fe-builder /fe/public /app/web/frontend/public

COPY scripts/start-all.sh /app/start-all.sh
RUN sed -i 's/\r$//' /app/start-all.sh && chmod +x /app/start-all.sh

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -sf "http://127.0.0.1:${PORT:-3000}/" >/dev/null || exit 1

CMD ["/app/start-all.sh"]
