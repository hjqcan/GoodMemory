# GoodMemory HTTP bridge — one-command memory-layer sidecar.
#
#   docker build -t goodmemory-bridge .
#   docker run -d -p 8739:8739 -e GOODMEMORY_HTTP_BRIDGE_TOKEN=<token> \
#     -v goodmemory-data:/app/.goodmemory goodmemory-bridge
#
# The bridge is Bun-hard (Bun.serve, bun:sqlite), so the base image must be
# oven/bun; the tag is pinned to the CI Bun version. Vector acceleration is
# disabled so sqlite-vss native libraries (libgomp/atlas/lapack) are not
# required; SQLite stays fully durable without it. Provide the bearer token at
# run time — the bridge refuses to start without one unless --allow-insecure.
FROM oven/bun:1.3.14-slim

WORKDIR /app
ENV NODE_ENV=production \
    GOODMEMORY_HTTP_BRIDGE_HOST=0.0.0.0 \
    GOODMEMORY_HTTP_BRIDGE_PORT=8739 \
    GOODMEMORY_SQLITE_VECTOR_MODE=off

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY scripts/goodmemory-http-bridge.ts ./scripts/goodmemory-http-bridge.ts

RUN mkdir -p /app/.goodmemory && chown -R bun:bun /app
USER bun
VOLUME /app/.goodmemory
EXPOSE 8739

# bun -e instead of curl: slim images ship no curl, bun is always present.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD ["bun", "-e", \
  "const p=process.env.GOODMEMORY_HTTP_BRIDGE_PORT??'8739';fetch('http://127.0.0.1:'+p+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# ENTRYPOINT so run-time args append: `docker run image --profile life-coach`.
ENTRYPOINT ["bun", "run", "scripts/goodmemory-http-bridge.ts"]
