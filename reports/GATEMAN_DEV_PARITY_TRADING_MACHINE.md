# Gateman Analysis - Dev Parity Trading Machine

Date: 2026-05-17
Branch: `codex/dev-parity-trading-machine`

## Scope

- Perps settlement indexing in Ponder.
- API reconciliation endpoint and Ponder GraphQL settlement reader.
- Perps reconciliation helper and tests.
- Phase B-E event ABI additions.
- Connected-wallet Trade Island entrypoint.

## Result

No blocking findings remain for this diff.

One boundary issue was found during review and fixed before shipping: the API Ponder reader trusted GraphQL row shape after `fetch`. It now normalizes and validates settlement rows at runtime, rejects malformed numeric and hex fields, and only falls back to the no-argument query when the error is an unsupported GraphQL query shape.

## Checks

- Assume Nothing: Ponder GraphQL responses are now runtime-validated before reconciliation.
- Question Everything: ABI event definitions were checked against the Telarana Phase B-E contracts.
- Worship No One: Ponder query fallback now avoids swallowing malformed responses and HTTP failures.
- Applaud Humility: repo lint remains red from unrelated legacy web files, so this PR keeps scope to the perps parity surface.

## Verification

- `bun run typecheck` - pass.
- `bun test packages/perps packages/db packages/mcp apps/api/src/ponder-client.test.ts` - pass, 27 tests.
- `bun run build` - pass.
- `bun run canary:perps-replacement:local` - pass.
- `BUFI_DB_PATH="$PWD/.bufi/perps-replacement-browser-gateman.sqlite" BUFI_API_URL=http://localhost:3005 BUFI_WEB_URL=http://localhost:3002 bun run smoke:perps-replacement:browser` - pass.

## Residual Risk

- `bun run lint` remains failing across the existing web app lint backlog: 126 errors and 115 warnings. The failures are broad legacy/generated-code issues outside this perps parity diff.
