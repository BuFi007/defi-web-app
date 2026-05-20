# Integrator API-key issuance — v0.1 (local-stub) disclosure

Wave I4 ships the integrator dashboard UI. PR #73 (Wave H2) already gates
`/webhooks/subscriptions/*` behind `X-Bufi-Api-Key: <id>.<secret>`, but the
matching **issuance** route does NOT exist yet. There is no
`POST /integrators/keys` in `apps/api/src/routes/`. Building that route is a
follow-up cycle.

To unblock the dashboard's "Create API key" flow today, this directory
ships a **local-stub** key generator:

1. `useDashboardApiKeys()` mints `<id>.<secret>` pairs in the browser using
   `crypto.getRandomValues`.
2. Keys are persisted to `localStorage` under
   `BUFI_DASHBOARD_API_KEYS_V1`. The active key id is tracked separately
   under `BUFI_DASHBOARD_ACTIVE_KEY_V1`.
3. Every dashboard request (`useWebhookSubscriptions`, etc.) reads
   `useActiveDashboardApiKey()` and sends the resulting header to the API.
4. The API's dev fallback (`apps/api/src/routes/webhooks/auth.ts`,
   non-production only) accepts any non-empty header value and treats the
   whole string as the `integratorId` — so the stub keys work end-to-end
   without any backend changes.

## What the next cycle will do

When `POST /integrators/keys` ships:

- The "Generate dev key" CTA in `app/[locale]/dashboard/api-keys/page.tsx`
  is replaced with a real POST that returns `{ id, secret, createdAt }`.
- The one-time-shown secret is surfaced via `<ApiKeyIssuer />` (already
  built for this PR — it just needs the real fetcher wired in).
- The local-stub `useDashboardApiKeys` hook is replaced with a real
  `useQuery(["dashboard", "api-keys"])` against the new list route.
- The README's "production-mode" warning below is removed.

## ⚠️ Production warning

This stub MUST NOT be enabled in production. Today's gate is implicit —
the API's `auth.ts` only permits the dev fallback when
`NODE_ENV !== "production"`. In production, only keys that match
`BUFI_WEBHOOK_INTEGRATORS=id1:secret1,id2:secret2` will authenticate, so
locally-stubbed keys will return `401`.

Until the real issuance route ships, the dashboard renders a one-time
disclaimer banner explaining that keys are local-only and will be
re-issued from a real backend in a later release.
