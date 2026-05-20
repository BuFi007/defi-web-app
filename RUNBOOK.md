# BUFI Operations Runbook

Operational decisions that survive across PRs. Skip the README narrative —
this file is for region pins, deploy targets, and other facts the team needs
in one place when things break.

## Deploy targets

- `apps/web` — **Vercel**, project `defi-web-app` (org `team_KIYDIBpOESSx…`).
  Linked via `.vercel/project.json` at repo root.
- `apps/api` — **Railway**, same project as sibling `fx-bento` (the project
  hosts both backends to share Postgres / Redis / Pyth env). Region inherited
  from the project setting — see Redis section below for the lock.
- Keepers (`apps/keeper-*`) — local Bun loops today; wk 3 plan moves the
  schedulable ones to **Vercel Cron** (HTTPS-pinging Railway-hosted apps/api
  internal routes).

## Redis (perps WS + pub/sub) — REGION LOCK

**Provider**: Upstash
**Region**: MUST match the Railway project region used by `apps/api` (which
is the same project as `fx-bento`). Confirm the exact value from the
Railway project settings UI before provisioning. Default placeholder
below; replace with the real region when the Upstash instance is created.

> **Region**: `<MATCH-RAILWAY-PROJECT-REGION>` (fill from Railway dashboard)

**Rationale**

- Sub-100ms WS budget = ~5-15ms Redis hop, same-region.
- Cross-region hop = 50-200ms, blows the budget.
- Loopback (co-located Redis on the same box) is faster but tunes
  development against numbers production won't ship. Do not.

**Hard rules**

1. Development, staging, and demo all run against Upstash same-region.
   No exceptions for "convenience."
2. If `apps/api`'s Railway project ever migrates region, this runbook
   entry is the first item updated and a new Upstash instance is
   provisioned in the new region BEFORE the API cutover.
3. Loopback Redis is permitted ONLY as a temporary swap on the literal
   demo-day machine, never in any environment another engineer touches.

**Verify before WS work starts**

- [ ] Railway project region confirmed (Railway dashboard → Project → Settings)
- [ ] Upstash instance provisioned in matching region
- [ ] `REDIS_URL` env wired in Railway (apps/api) + bun dev
- [ ] Latency check: `redis-cli --latency` from API box reads <20ms p99
