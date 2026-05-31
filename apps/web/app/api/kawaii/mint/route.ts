import { NextRequest, NextResponse } from "next/server";
import { verifyMessage, isAddress, getAddress } from "viem";
import { prisma } from "@/lib/prisma";
import { KAWAII_GATE, RESERVED_BASES } from "@/lib/kawaii/config";
import { mintAvatar, MintError } from "@/lib/kawaii/mint-service";
import { verifyUsdcPaymentArc } from "@/lib/kawaii/payment";
import { ownerOfAgent } from "@/lib/kawaii/erc8004";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/kawaii/mint — mint a Kawaii Punk avatar (testnet tier).
 *
 * Auth = wallet signature (SIWE-style, matching the app's existing pattern):
 * the client signs the canonical mint intent; we recover/verify the signer and
 * use THAT as `to`. The body NEVER carries `to`/`uri`/`cid`/`tokenId` (rejected).
 *
 * Gate order: signature → forbidden-field reject → socials (testnet: all 3) →
 * whitelist (free) | payment (402, wired in A.8) → mint-service (reserved gate,
 * server-side compose+pin, Circle mintTo).
 */
const FORBIDDEN = ["to", "uri", "cid", "tokenId", "tokenURI"] as const;

function mintMessage(p: { wallet: string; baseId: string; deadline: number; nonce: string }): string {
  return `Kawaii Punk mint\nwallet:${p.wallet}\nbase:${p.baseId}\ndeadline:${p.deadline}\nnonce:${p.nonce}`;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Reject (don't ignore) any attempt to inject art/recipient/token fields.
  for (const f of FORBIDDEN) {
    if (f in body) return NextResponse.json({ error: `field "${f}" not allowed` }, { status: 400 });
  }

  const { wallet, baseId, layers, deadline, nonce, signature, agentId } = body as {
    wallet?: string; baseId?: string; layers?: Record<string, string>;
    deadline?: number; nonce?: string; signature?: `0x${string}`; agentId?: string;
  };

  if (!wallet || !isAddress(wallet)) return NextResponse.json({ error: "bad wallet" }, { status: 400 });
  if (!baseId || typeof baseId !== "string") return NextResponse.json({ error: "bad baseId" }, { status: 400 });
  if (!deadline || !nonce || !signature) return NextResponse.json({ error: "missing signature/deadline/nonce" }, { status: 400 });
  if (Date.now() / 1000 > deadline) return NextResponse.json({ error: "intent expired" }, { status: 400 });

  // ---- Verify wallet ownership via signature ----
  const addr = getAddress(wallet);
  const ok = await verifyMessage({ address: addr, message: mintMessage({ wallet: addr, baseId, deadline, nonce }), signature })
    .catch(() => false);
  if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  const lc = addr.toLowerCase();

  const tier = "testnet" as const;
  const cfg = KAWAII_GATE[tier];

  // Agent badge: an ERC-8004 identity the wallet owns on-chain links to the Punk.
  const isVerifiedAgent = !!agentId && /^\d+$/.test(agentId) && (await ownerOfAgent(BigInt(agentId)))?.toLowerCase() === lc;

  const wl = await prisma.gateWhitelist.findUnique({ where: { address: lc } });
  const reserved = baseId in RESERVED_BASES;

  // NO social gate — minting is open. Auth is the wallet signature; access is
  // gated only by whitelist (free) or USDC payment on Arc. (Guild/X/Discord
  // verification was removed: too much friction and unreliable validation.)
  let payToken: "free" | "USDC" = "free";
  let amountPaid: string | undefined;
  let paymentTx: string | undefined;
  if (!wl && !reserved) {
    const ptx = typeof (body as { paymentTx?: unknown }).paymentTx === "string"
      ? ((body as { paymentTx: string }).paymentTx as `0x${string}`)
      : undefined;
    if (!ptx) {
      return NextResponse.json(
        { error: "payment_required", token: "USDC", to: cfg.earningsRecipient, priceUsdc: cfg.priceUsdc.toString(), chainId: cfg.chainId },
        { status: 402 },
      );
    }
    const used = await prisma.mint.findFirst({ where: { paymentTx: ptx } });
    if (used) return NextResponse.json({ error: "payment tx already used" }, { status: 409 });
    try {
      const paid = await verifyUsdcPaymentArc({
        txHash: ptx, usdc: getAddress(cfg.usdc), recipient: getAddress(cfg.earningsRecipient),
        payer: addr, minAmount6: cfg.priceUsdc,
      });
      payToken = "USDC"; amountPaid = paid.toString(); paymentTx = ptx;
    } catch (e) {
      return NextResponse.json({ error: "payment_unverified", reason: String((e as Error).message ?? e) }, { status: 402 });
    }
  }

  // ---- Mint ----
  try {
    const result = await mintAvatar({
      wallet: lc, tier, baseId, layers: layers as never,
      payToken, amountPaid, paymentTx,
      agentId: isVerifiedAgent ? agentId : undefined,
      idempotencyKey: `${lc}:${baseId}:${nonce}`,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof MintError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: `mint failed: ${String((e as Error).message ?? e)}` }, { status: 500 });
  }
}
