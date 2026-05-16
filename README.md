# BUFI · FX Telaraña · FX² Arcade

Bun-workspaces monorepo.

```
apps/
  web/      Next.js 16 frontend (the product)
  api/      Hono API (perps, fx-bento, fx-telarana, mcp, x402)
  ponder/   onchain indexer
packages/
  liveblocks/    realtime rooms (wallet-scoped auth)
  x402/          payment-gated route middleware
  mcp/           agent-operable workflow registry + state machine
  shared-types/  cross-package types
  env/           typed env validation
  contracts/     ABIs + addresses
services/        future split-out backend services
```

## Run

```bash
bun install
bun run dev          # apps/web on :3000
bun run dev:api      # apps/api on :3002
bun run dev:ponder   # apps/ponder on :42069
```

## Deploy notes

Vercel project `defi-web-app` must have **Root Directory = `apps/web`** in dashboard settings. The repo no longer has a Next app at the root.
