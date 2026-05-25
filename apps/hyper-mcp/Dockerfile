FROM oven/bun:1.3 AS base
WORKDIR /app

COPY package.json bun.lock* ./
COPY packages/ packages/
COPY apps/hyper-mcp/ apps/hyper-mcp/

RUN bun install --production

EXPOSE 4002
ENV PORT=4002
ENV NODE_ENV=production

CMD ["bun", "apps/hyper-mcp/src/app.ts"]
