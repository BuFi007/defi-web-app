# `@bufi/sdk`

Public TypeScript SDK for the [BUFI](https://bu.finance) perps + FX
protocol. Wraps the REST API, EIP-712 typed-data helpers, contract
addresses, and ABIs into one integrator-friendly surface — so aggregators,
wallets, and portfolio trackers can build on BUFI without depending on the
internal monorepo.

> Status: **v0.1 scaffold.** Public API is stable for the surface listed
> below; sub-paths beyond what's exported via `package.json#exports` are
> internal.

## Install

```sh
npm install @bufi/sdk viem
# Optional, only if you use the React hooks (sdk/react):
npm install @tanstack/react-query react
```

`viem`, `@tanstack/react-query`, and `react` are declared as
**peer dependencies** — the SDK adopts the host app's versions instead of
pulling its own.

## Quickstart

```ts
import { createBufiClient, openPerp } from "@bufi/sdk";
import { ARC_PERP_MARKETS, arcTestnet } from "@bufi/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";

const bufi = createBufiClient({
  apiUrl: "https://api.bu.finance",
  chainId: 5042002, // Arc Testnet
});

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({
  account,
  chain: arcTestnet,
  transport: http(),
});

const { intentId, status } = await openPerp(bufi, {
  marketId: ARC_PERP_MARKETS["EURC/USDC"].marketId,
  side: "long",
  sizeUsdc: "10",
  leverage: 5,
  walletClient,
});

console.log({ intentId, status });
```

Run the bundled example with:

```sh
PRIVATE_KEY=0x… BUFI_API_URL=http://localhost:3002 \
  bun run examples/quickstart.ts
```

## Package surface

```
@bufi/sdk                  — barrel: everything below
@bufi/sdk/client           — createBufiClient, BufiClient, BufiApiError
@bufi/sdk/chains           — arcTestnet, avalancheFuji, CHAIN_IDS
@bufi/sdk/contracts        — addresses + ABIs (re-exported from @bufi/contracts)
@bufi/sdk/errors           — BufiApiError, SignatureError, OracleStaleError, …

@bufi/sdk/perps            — barrel for the flows below
@bufi/sdk/perps/open       — openPerp({ marketId, side, sizeUsdc, leverage, walletClient })
@bufi/sdk/perps/close      — closePerp({ marketId, walletClient })
@bufi/sdk/perps/margin     — depositMargin / withdrawMargin / getMarginBalance
@bufi/sdk/perps/orders     — placeLimitOrder, replaceLimitOrder, prepareReplacement
@bufi/sdk/perps/typed-data — buildPerpsOrderTypedData (re-exports from @bufi/perps)

@bufi/sdk/queries          — barrel for the read endpoints
@bufi/sdk/queries/markets  — getMarkets, getMarket, getMarkPrice
@bufi/sdk/queries/positions— getPositions, getTrades
@bufi/sdk/queries/analytics— getOhlcv, getMarketStats, getPendingIntents
```

Every sub-path is a separate import, so a tree-shaking bundler will only
include what you use:

```ts
// Pulls in *only* the close flow + its dependencies.
import { closePerp } from "@bufi/sdk/perps/close";
```

## Flows

### Open a position

```ts
import { openPerp } from "@bufi/sdk";

const result = await openPerp(bufi, {
  marketId: ARC_PERP_MARKETS["EURC/USDC"].marketId,
  side: "long",
  sizeUsdc: "10",     // 10 USDC notional
  leverage: 5,        // 5x
  walletClient,       // viem WalletClient with an account
});
// result.intentId — keeper's reference; poll status via getIntent
// result.quote    — pre-flight quote (fee, markPrice, requiredMargin)
```

### Close a position

```ts
import { closePerp } from "@bufi/sdk";

// Full close — size read from /perps/positions/:address.
await closePerp(bufi, { marketId, walletClient });

// Partial close.
await closePerp(bufi, { marketId, sizeUsdc: "5", walletClient });
```

### Limit orders

```ts
import { placeLimitOrder, replaceLimitOrder } from "@bufi/sdk";

const { intentId } = await placeLimitOrder(bufi, {
  marketId,
  side: "long",
  sizeUsdc: "50",
  leverage: 3,
  priceE18: "1080000000000000000", // 1.08, 18dp fixed-point
  walletClient,
});

// Replace with a new price (nonce must be strictly greater).
await replaceLimitOrder(bufi, {
  intentId,
  nonce: "1",
  deadline: Math.floor(Date.now() / 1000) + 600,
  priceE18: "1075000000000000000",
  signature, // signed over `prepareReplacement(...)` output
});
```

### Margin

```ts
import { depositMargin, withdrawMargin, getMarginBalance } from "@bufi/sdk";

// 1. ERC-20 approve USDC for the marginAccount address (use viem directly).
// 2. Deposit.
await depositMargin(bufi, { amount: 100_000_000n, walletClient }); // 100 USDC

// 3. Read balance.
const balance = await getMarginBalance(bufi, {
  trader: account.address,
  publicClient,
});

// 4. Withdraw.
await withdrawMargin(bufi, { amount: 50_000_000n, walletClient });
```

### Streaming mark price

The HTTP `getMarkPrice` returns a snapshot; for live updates, subscribe to
the WebSocket directly:

```ts
const ws = new WebSocket("wss://api.bu.finance/ws/markets/" + marketId);
ws.onmessage = (e) => console.log("tick", JSON.parse(e.data));
```

A typed WebSocket wrapper will ship in a later SDK release.

## Errors

Every async function throws one of the typed errors from
`@bufi/sdk/errors`. Use `instanceof` to narrow:

```ts
import { BufiApiError, OracleStaleError, SignatureError } from "@bufi/sdk";

try {
  await openPerp(bufi, args);
} catch (err) {
  if (err instanceof OracleStaleError) {
    // Pyth feed is stale — retry in a few seconds.
  } else if (err instanceof SignatureError) {
    // User rejected the wallet signature.
  } else if (err instanceof BufiApiError) {
    // Non-2xx from the API. `err.status` + `err.body` are populated.
    console.error(err.status, err.body, err.requestId);
  } else {
    throw err;
  }
}
```

## Configuration

`createBufiClient` accepts:

| option       | default                     | meaning                                                |
| ------------ | --------------------------- | ------------------------------------------------------ |
| `apiUrl`     | `https://api.bu.finance`    | Base URL of the BUFI API.                              |
| `chainId`    | undefined                   | Default chain — overridable per-call.                  |
| `fetch`      | `globalThis.fetch`          | Inject for SSR / OTEL / auth-wrapping fetch.           |
| `timeoutMs`  | `30_000`                    | Per-request timeout; the SDK aborts.                   |
| `headers`    | `{}`                        | Merged into every request.                             |

## Build pipeline

This package is built with `tsc` only — no bundler. Output is ESM, targeted
at modern bundlers (Vite, Next.js, esbuild, Bun). Pure-node consumers
should use `node 22+` (or set `"moduleResolution": "bundler"` in their own
tsconfig) so the extensionless ESM imports resolve. A `tsup` build pass
producing dual ESM+CJS is on the v0.2 roadmap.

```sh
bun run --filter @bufi/sdk typecheck
bun run --filter @bufi/sdk build
```

## Roadmap

This is the **scaffold** (v0.1). Planned upgrades:

- v0.2 — `tsup`-based dual ESM/CJS build, native `node 18` consumption.
- v0.3 — Typed WebSocket wrappers for mark price + orderbook deltas.
- v0.4 — `@bufi/sdk/react` hooks (`useMarkPrice`, `useOpenPerp`).
- v1.0 — Replace the hand-typed REST client with `hc<AppType>` once
  `@bufi/api` exports its Hono `AppType`.

## License

MIT.
