/**
 * Liveblocks auth endpoint for the FX² Arcade (Bento) and other Bufi
 * realtime surfaces.
 *
 * Contract:
 *   POST /api/liveblocks/auth
 *   body: { room: string }                  <- supplied by Liveblocks SDK
 *   headers (optional, for wallet-gated rooms):
 *     X-Wallet-Address
 *     X-Wallet-ChainId
 *     X-Wallet-Signature
 *     X-Wallet-TypedData  (preferred) OR  X-Wallet-Message  (legacy)
 *
 * The room id must conform to one of the canonical room id shapes:
 *   `bufi:<chainId>:perps:<marketId>`
 *   `bufi:<chainId>:arcade:fx-bento:<roomId>`
 *   `bufi:<chainId>:fx-telarana:<marketId>`
 *   `bufi:mcp:workflow:<workflowId>`
 *
 * `authorizeLiveblocksRoom` already enforces that the room's chain id (if
 * any) matches the session chain id — a session minted on Arc Testnet
 * cannot read a Fuji room.
 *
 * Production fallback: when LIVEBLOCKS_SECRET_KEY is not set the route
 * 503s instead of crashing. Realtime is treated as a progressive
 * enhancement — the Arcade still works without presence updates.
 *
 * Dev fallback: when NODE_ENV !== "production" and the caller did not
 * supply wallet headers, the route accepts `address`/`chainId` in the
 * body so the in-memory simulator can mint tokens without an EIP-712
 * signing dance. Production refuses unauthenticated requests.
 */

import { NextResponse } from "next/server";
import {
  isAddress,
  recoverMessageAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";

import {
  authorizeLiveblocksRoom,
  parseRoomId,
} from "@bufi/liveblocks/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 24h, matches apps/api
const SUPPORTED_CHAIN_IDS = new Set([43113, 919, 5042002]);

interface WalletSessionTypedDataPayload {
  domain: { name: string; version: string; chainId: number };
  types: { WalletSession: Array<{ name: string; type: string }> };
  primaryType: "WalletSession";
  message: {
    purpose: string;
    wallet: `0x${string}`;
    chainId: string;
    origin: string;
    iat: string;
    exp: string;
  };
}

interface VerifiedWalletSession {
  address: Address;
  chainId: number;
}

async function verifyWalletHeaders(req: Request): Promise<VerifiedWalletSession | null> {
  const addr = req.headers.get("X-Wallet-Address");
  const chainHeader = req.headers.get("X-Wallet-ChainId");
  const signature = req.headers.get("X-Wallet-Signature");
  const typedDataHeader = req.headers.get("X-Wallet-TypedData");
  const message = req.headers.get("X-Wallet-Message");

  if (!addr || !chainHeader || !signature) return null;
  if (!isAddress(addr)) return null;

  const chainId = Number(chainHeader);
  if (!SUPPORTED_CHAIN_IDS.has(chainId)) return null;

  const now = Math.floor(Date.now() / 1000);

  if (typedDataHeader) {
    let parsed: WalletSessionTypedDataPayload;
    try {
      parsed = JSON.parse(typedDataHeader) as WalletSessionTypedDataPayload;
    } catch {
      return null;
    }
    if (parsed.primaryType !== "WalletSession") return null;
    if (!parsed.message?.iat || !parsed.message?.exp) return null;
    if (parsed.message.wallet.toLowerCase() !== addr.toLowerCase()) return null;
    if (Number(parsed.message.chainId) !== chainId) return null;
    const iat = Number(parsed.message.iat);
    const exp = Number(parsed.message.exp);
    if (now - iat > SESSION_MAX_AGE_SECONDS || now > exp) return null;
    let recovered: Address;
    try {
      recovered = await recoverTypedDataAddress({
        domain: parsed.domain,
        types: parsed.types,
        primaryType: parsed.primaryType,
        message: {
          purpose: parsed.message.purpose,
          wallet: parsed.message.wallet,
          chainId: BigInt(parsed.message.chainId),
          origin: parsed.message.origin,
          iat: BigInt(parsed.message.iat),
          exp: BigInt(parsed.message.exp),
        },
        signature: signature as Hex,
      });
    } catch {
      return null;
    }
    if (recovered.toLowerCase() !== addr.toLowerCase()) return null;
    return { address: addr as Address, chainId };
  }

  if (message) {
    const iatMatch = /iat:(\d+)/.exec(message);
    const expMatch = /exp:(\d+)/.exec(message);
    const iat = iatMatch ? Number(iatMatch[1]) : 0;
    const exp = expMatch ? Number(expMatch[1]) : iat + SESSION_MAX_AGE_SECONDS;
    if (!iat || now - iat > SESSION_MAX_AGE_SECONDS || now > exp) return null;
    let recovered: Address;
    try {
      recovered = await recoverMessageAddress({ message, signature: signature as Hex });
    } catch {
      return null;
    }
    if (recovered.toLowerCase() !== addr.toLowerCase()) return null;
    return { address: addr as Address, chainId };
  }

  return null;
}

export async function POST(req: Request) {
  if (!process.env.LIVEBLOCKS_SECRET_KEY) {
    return NextResponse.json(
      { error: "liveblocks_not_configured" },
      { status: 503 },
    );
  }

  let body: { room?: unknown; address?: unknown; chainId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const room = typeof body.room === "string" ? body.room : null;
  if (!room) {
    return NextResponse.json({ error: "missing_room" }, { status: 400 });
  }

  const parsedRoom = parseRoomId(room);
  if (!parsedRoom) {
    return NextResponse.json({ error: "invalid_room_id" }, { status: 400 });
  }

  let session = await verifyWalletHeaders(req);
  if (!session) {
    // Dev/test fallback: accept body-provided identity so the in-memory
    // simulator UI can mount the Liveblocks room without the EIP-712
    // signing dance. Production refuses this path.
    if (process.env.NODE_ENV !== "production") {
      const bodyAddress = typeof body.address === "string" ? body.address : null;
      const bodyChainId =
        typeof body.chainId === "number"
          ? body.chainId
          : typeof body.chainId === "string"
            ? Number(body.chainId)
            : NaN;
      if (
        bodyAddress &&
        isAddress(bodyAddress) &&
        Number.isFinite(bodyChainId) &&
        SUPPORTED_CHAIN_IDS.has(bodyChainId)
      ) {
        session = { address: bodyAddress as Address, chainId: bodyChainId };
      }
    }
  }

  if (!session) {
    return NextResponse.json({ error: "wallet_session_required" }, { status: 401 });
  }

  // Roomed-scoped chain check — `authorizeLiveblocksRoom` re-validates
  // this, but failing fast with a 403 here gives a clearer error than the
  // generic "session authorize failed".
  if (parsedRoom.kind !== "mcp" && parsedRoom.chainId !== session.chainId) {
    return NextResponse.json(
      { error: "room_chain_mismatch", room: parsedRoom.chainId, session: session.chainId },
      { status: 403 },
    );
  }

  try {
    const issued = await authorizeLiveblocksRoom({
      address: session.address,
      chainId: session.chainId,
      roomIds: [room],
      role: parsedRoom.kind === "arcade" ? "player" : "trader",
    });
    return NextResponse.json(issued);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
