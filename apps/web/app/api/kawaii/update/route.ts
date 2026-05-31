import { NextRequest, NextResponse } from "next/server";
import { verifyMessage, isAddress, getAddress } from "viem";
import { prisma } from "@/lib/prisma";
import { updateAvatar, resolveMintTokenId } from "@/lib/kawaii/update-service";
import { MintError } from "@/lib/kawaii/mint-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/kawaii/update — re-skin an already-minted Kawaii Punk.
 *
 * Auth = wallet signature over the canonical update intent (same pattern as
 * /mint). The client NEVER supplies to/uri/cid/tokenId — the token id is read
 * from OUR mint ledger for the recovered signer. Server then re-composes from
 * the chosen base + traits (NFT variants), re-pins to IPFS, and setTokenURI's
 * the ERC-1155 via the Circle mint authority.
 */
const FORBIDDEN = ["to", "uri", "cid", "tokenId", "tokenURI"] as const;

function updateMessage(p: { wallet: string; baseId: string; deadline: number; nonce: string }): string {
  return `Kawaii Punk update\nwallet:${p.wallet}\nbase:${p.baseId}\ndeadline:${p.deadline}\nnonce:${p.nonce}`;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  for (const f of FORBIDDEN) {
    if (f in body) return NextResponse.json({ error: `field "${f}" not allowed` }, { status: 400 });
  }

  const { wallet, baseId, layers, deadline, nonce, signature } = body as {
    wallet?: string; baseId?: string; layers?: Record<string, string>;
    deadline?: number; nonce?: string; signature?: `0x${string}`;
  };

  if (!wallet || !isAddress(wallet)) return NextResponse.json({ error: "bad wallet" }, { status: 400 });
  if (!baseId || typeof baseId !== "string") return NextResponse.json({ error: "bad baseId" }, { status: 400 });
  if (!deadline || !nonce || !signature) return NextResponse.json({ error: "missing signature/deadline/nonce" }, { status: 400 });
  if (Date.now() / 1000 > deadline) return NextResponse.json({ error: "intent expired" }, { status: 400 });

  // ---- Verify wallet ownership via signature ----
  const addr = getAddress(wallet);
  const ok = await verifyMessage({ address: addr, message: updateMessage({ wallet: addr, baseId, deadline, nonce }), signature })
    .catch(() => false);
  if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  const lc = addr.toLowerCase();

  // ---- Ownership: the wallet must already hold a minted Punk with a token id ----
  const mint = await prisma.mint.findFirst({ where: { address: lc }, orderBy: { createdAt: "desc" } });
  if (!mint) return NextResponse.json({ error: "no_punk", reason: "this wallet has not minted a Kawaii Punk" }, { status: 404 });
  if (mint.tier !== "testnet") {
    // updateAvatar targets the testnet ERC-1155; never send a mainnet token id there.
    return NextResponse.json({ error: "unsupported_tier", reason: "on-chain re-skin is only live for testnet Punks right now" }, { status: 409 });
  }
  // No event monitor populates tokenId — resolve it from the mint receipt on
  // demand and backfill the ledger so future updates are instant.
  let tokenId = mint.tokenId;
  if (!tokenId) {
    tokenId = await resolveMintTokenId(mint);
    if (tokenId) await prisma.mint.update({ where: { id: mint.id }, data: { tokenId } });
  }
  if (!tokenId) {
    return NextResponse.json({ error: "token_pending", reason: "your mint isn't confirmed on-chain yet — try again in a moment" }, { status: 409 });
  }

  try {
    const result = await updateAvatar({ wallet: lc, tier: "testnet", baseId, layers: layers as never, tokenId });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof MintError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: `update failed: ${String((e as Error).message ?? e)}` }, { status: 500 });
  }
}
