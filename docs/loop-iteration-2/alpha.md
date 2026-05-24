# Team ALPHA — Iteration 2

## ALPHA.1 — Hydration

- reactFiber count before fix: **0** (per ECHO iter-1 capture)
- reactFiber count after iter-1 partial fix (already landed at HEAD): **364** on `/`
- Root cause: the original iter-1 hydration failure was already resolved by the
  prior `cacheComponents:false` + eager `DynamicProviders` patch. Hydration is
  GREEN — click handlers fire (verified by closing the Discord banner), the
  hamburger menu carries aria labels, and the DynamicWidget mounts inside a
  shadow DOM with a working "Log in or sign up" button that opens the modal.
- Surviving regression discovered while reproducing: the **Welcome / Dynamic
  auth card was unreachable on local dev**. `NEXT_PUBLIC_BENTO_E2E=1` (set in
  `.env.local` for QA) caused `DevWalletProvider` to mint a deterministic
  account, which `SessionBridge` unconditionally promoted to a connected
  session → `useBufiIsConnected()` returned `true` forever → `home/index.tsx`
  routed to `TradeIsland` and the welcome card never rendered. The original
  design contract (per `home/index.tsx:39-41`) requires BOTH the env flag
  AND `?force-island=1` to bypass auth; only the home gate enforced it.
- Files changed:
  - `apps/web/lib/session/session-bridge.tsx:4` (added `useSearchParams` import)
  - `apps/web/lib/session/session-bridge.tsx:35-44` (added `devWalletActive` gate)
  - `apps/web/lib/session/session-bridge.tsx:55-62` (gated dev-wallet branch)
  - `apps/web/lib/session/session-bridge.tsx:163-172` (added `devWalletActive` to deps)
- Commit: `44a18c5` on `feat/wk1n14-privacy-pools-live`
- reactFiber count after fix: **35** on `/` (welcome card path, simpler tree);
  **364** on `/?force-island=1` (island path)
- Status: **GREEN**

## ALPHA.2 — Tabs

Tested via `?force-island=1` (Dynamic email-OTP flow is blocked by a CORS
preflight failure against `https://app.dynamicauth.com/.../emailVerifications/create`
— the env ID `8f49e843…` doesn't allow-list `https://localhost:3001`. This is a
Dynamic dashboard config gap, not a code bug. Flag for OPS to add the origin.)

| tab | renders? | interactive? | screenshot |
| --- | --- | --- | --- |
| Trade | yes | yes (TF buttons, leverage, order mode all click) | `/tmp/alpha-tab-trade.png` |
| Loan / Borrow | yes (14 markets across Arc + Fuji) | yes | `/tmp/alpha-tab-loan.png` |
| Positions | yes ("Connect a wallet" CTA, expected without auth) | n/a | `/tmp/alpha-tab-positions.png` |
| Leaderboard | yes ("Connect a wallet" CTA, expected) | n/a | `/tmp/alpha-tab-leaders.png` |
| History | yes ("No closed trades yet" empty state) | n/a | `/tmp/alpha-tab-history.png` |
| Ghost Mode toggle | yes | yes (toggles) | `/tmp/alpha-ghost-on.png` |

No separate Privacy tab — Ghost Mode is a header toggle, not a tab.
No separate Pools tab on this branch (privacy-pools surface lives behind
Ghost Mode + the loan markets).

## ALPHA.3 — CTA polish

- Welcome card snapshot: `/tmp/alpha-welcome-card.png`
- The DynamicWidget renders as a centered "Log in or sign up" pill inside the
  card under the emoji line. Visually integrated — purple card border frames
  it, and the button doesn't fight the existing copy. **No polish change
  needed.** Click verified: opens the Dynamic auth modal with MetaMask,
  Coinbase, WalletConnect, and email options.

## Handoffs

- **To ECHO: GO** for dogfooding the not-connected → connected flow up to
  the Dynamic modal. **BLOCKED at OTP submission** — the local origin
  `https://localhost:3001` is not allow-listed in the Dynamic dashboard for
  env `8f49e843-08dc-4654-a1fd-36b1dc59d709`, so `emailVerifications/create`
  fails CORS preflight. Two unblocks: (a) ops adds origin to Dynamic
  allow-list (5 min in dashboard); or (b) ECHO dogfoods the island via
  `?force-island=1` which uses the dev-mock wallet end-to-end.
- All five tabs render and the island is interactive under `?force-island=1`.
- Hydration is no longer the blocker — every other subteam can assume
  client-side state works.
