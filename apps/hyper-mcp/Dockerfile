FROM oven/bun:1.3 AS base
WORKDIR /app

COPY package.json bun.lock* ./
COPY packages/ packages/
COPY apps/ apps/

RUN bun install --no-save

ENV NODE_ENV=production

CMD ["sh", "-c", "exec ${RAILWAY_START_COMMAND:-bun apps/hyper-mcp/src/app.ts}"]
