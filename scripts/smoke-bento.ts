/**
 * Smoke test for the Bento (Arcade) dev simulator end-to-end.
 *
 * Exercises the full commit-reveal lifecycle without needing a browser
 * wallet:
 *   1. POST /fx-bento/dev/rooms            — create room (USDC/EURC, 3 rounds)
 *   2. POST /fx-bento/dev/rooms/:id/join   — join with the dev-mock-wallet
 *   3. POST /fx-bento/dev/rooms/:id/commit — per round: hash tiles + nonce → commitment
 *   4. POST /fx-bento/dev/rooms/:id/reveal — per round: reveal rows/cols/nonce
 *   5. POST /fx-bento/dev/rooms/:id/settle — flip room to settled
 *   6. GET  /fx-bento/rooms/:id/claims/:addr — fetch merkle proof
 *
 * Env:
 *   SMOKE_API_URL       (default http://localhost:3002)
 *   SMOKE_CHAIN_ID      (default 5042002)
 *   SMOKE_PRIVATE_KEY   (default the deterministic perps E2E key 0xaaaa…)
 *   SMOKE_MARKET_ID     (default USDC/EURC — must be in FX_BENTO_MARKETS)
 *
 * Run: `bun run scripts/smoke-bento.ts`
 */

import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { buildSelectedTilesHash, buildSelectionCommitment } from "@bufi/fx-bento";

const apiUrl = process.env.SMOKE_API_URL ?? "http://localhost:3002";
const chainId = Number(process.env.SMOKE_CHAIN_ID ?? 5042002);
const privateKey =
  process.env.SMOKE_PRIVATE_KEY ??
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const marketId = process.env.SMOKE_MARKET_ID ?? "USDC/EURC";

if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
  console.error("SMOKE_PRIVATE_KEY must be a 32-byte hex private key");
  process.exit(1);
}

const account = privateKeyToAccount(privateKey as `0x${string}`);
// Second deterministic player so the room reaches minPlayers=2 and activates.
const PLAYER2_KEY = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const account2 = privateKeyToAccount(PLAYER2_KEY);

interface WalletHeaders {
  "X-Wallet-Address": string;
  "X-Wallet-ChainId": string;
  "X-Wallet-TypedData": string;
  "X-Wallet-Signature": string;
}

async function buildWalletSession(
  signer: ReturnType<typeof privateKeyToAccount>,
): Promise<WalletHeaders> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 86_400;
  const typedData = {
    domain: { name: "BUFX Wallet Session", version: "1", chainId },
    types: {
      WalletSession: [
        { name: "purpose", type: "string" },
        { name: "wallet", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "origin", type: "string" },
        { name: "iat", type: "uint256" },
        { name: "exp", type: "uint256" },
      ],
    },
    primaryType: "WalletSession" as const,
    message: {
      purpose: "bufx.smoke-bento",
      wallet: signer.address,
      chainId: BigInt(chainId),
      origin: apiUrl,
      iat: BigInt(iat),
      exp: BigInt(exp),
    },
  };
  const signature = await signer.signTypedData(typedData);
  const wire = JSON.stringify({
    ...typedData,
    message: {
      ...typedData.message,
      chainId: String(chainId),
      iat: String(iat),
      exp: String(exp),
    },
  });
  return {
    "X-Wallet-Address": signer.address,
    "X-Wallet-ChainId": String(chainId),
    "X-Wallet-TypedData": wire,
    "X-Wallet-Signature": signature,
  };
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

function randomNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function clientStateHashFor(rows: number[], cols: number[]): `0x${string}` {
  return keccak256(toHex(`smoke-bento:${rows.join(",")}|${cols.join(",")}`));
}

async function main() {
  const session = await buildWalletSession(account);
  const session2 = await buildWalletSession(account2);
  console.log("[smoke-bento] p1", account.address, "p2", account2.address, "chain", chainId);

  // 1. create
  const created = await api<{ id: string; rounds: number }>("POST", "/fx-bento/dev/rooms", {
    marketId,
    entryFeeUsdc: 5,
    minPlayers: 2,
    maxPlayers: 6,
    rounds: 3,
  });
  console.log(
    "[smoke-bento] created room",
    created.id,
    "market",
    marketId,
    "rounds",
    created.rounds,
  );

  // 2. join (requires wallet session per player — minPlayers=2 to activate)
  await api(
    "POST",
    `/fx-bento/dev/rooms/${created.id}/join`,
    { player: account.address },
    session,
  );
  await api(
    "POST",
    `/fx-bento/dev/rooms/${created.id}/join`,
    { player: account2.address },
    session2,
  );
  console.log("[smoke-bento] both joined; room should activate");

  // 3 + 4. commit + reveal per round
  // Pick 3 tiles per round (deterministic so re-runs are reproducible).
  const roundPicks: Array<{ rows: number[]; cols: number[] }> = [
    { rows: [0, 2, 4], cols: [1, 3, 5] },
    { rows: [1, 3, 5], cols: [0, 2, 4] },
    { rows: [0, 1, 2], cols: [5, 6, 7] },
  ];

  for (let roundIndex = 0; roundIndex < created.rounds; roundIndex++) {
    const pick = roundPicks[roundIndex] ?? roundPicks[0];
    const nonce = randomNonce();
    const clientStateHash = clientStateHashFor(pick.rows, pick.cols);
    const selectedTilesHash = buildSelectedTilesHash({
      rows: pick.rows,
      cols: pick.cols,
      chipCount: pick.rows.length,
      clientStateHash,
    });
    const commitment = buildSelectionCommitment({
      chainId,
      roomId: 0n, // simulator ignores the on-chain id; pass 0 for hash domain separation
      roundIndex,
      player: account.address,
      selectedTilesHash,
      nonce,
    });

    await api("POST", `/fx-bento/dev/rooms/${created.id}/commit`, {
      player: account.address,
      roundIndex,
      commitment,
    });
    console.log(
      `[smoke-bento] round ${roundIndex} committed`,
      `commitment=${commitment.slice(0, 18)}…`,
    );

    await api("POST", `/fx-bento/dev/rooms/${created.id}/reveal`, {
      player: account.address,
      roundIndex,
      rows: pick.rows,
      cols: pick.cols,
      nonce,
    });
    console.log(
      `[smoke-bento] round ${roundIndex} revealed`,
      `tiles=${pick.rows.length}`,
    );
  }

  // 5. settle (use a stub results root — simulator validates shape, not contents)
  const resultsRoot = keccak256(toHex(`smoke-bento-results:${created.id}`));
  const settled = await api<{ id: string; status: string }>(
    "POST",
    `/fx-bento/dev/rooms/${created.id}/settle`,
    { resultsRoot },
  );
  console.log("[smoke-bento] settled", settled.id, "status", settled.status);

  // 6. claim proof (sim may return null amount for non-winners; test the shape)
  const claim = await api<{
    chainId: number;
    roomId: string;
    address: string;
    amount: string;
    proof: string[];
  }>(
    "GET",
    `/fx-bento/rooms/${created.id}/claims/${account.address}?chainId=${chainId}`,
  );
  console.log(
    "[smoke-bento] claim",
    JSON.stringify(
      {
        address: claim.address,
        amount: claim.amount,
        proofLen: claim.proof.length,
      },
      null,
      2,
    ),
  );

  console.log("[smoke-bento] OK");
}

main().catch((err) => {
  console.error("[smoke-bento] FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
});
