import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { prisma } from "../prisma";
import { KAWAII_GATE, RESERVED_BASES, RESERVED_BASE_IDS, KAWAII_NEW_TOKEN_ID } from "./config";
import { composeAvatar, type AvatarSelection } from "./compose";
import { resolveLayerPath } from "./layers";
import { pinImagePng, pinMetadataJson, toTokenUri } from "./pin";
import { buildMetadata } from "./metadata";

export class MintError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface MintInput {
  wallet: string; // session-resolved `to` (never from request body)
  tier: keyof typeof KAWAII_GATE; // "testnet" (mainnet later)
  baseId: string; // reserved key OR open base filename
  layers?: AvatarSelection["layers"];
  payToken: "free" | "USDC" | "JPYC"; // determined by the route (whitelist/payment), not the client
  amountPaid?: string;
  idempotencyKey: string;
}

/** Reserved baseId → its dedicated base art filename. TODO: drop in the real
 *  criptopoeta / daniss / mcduck / circle avatar art (currently unset = 501). */
const RESERVED_BASE_ART: Partial<Record<string, string>> = {};

function env(k: string): string {
  const v = process.env[k];
  if (!v) throw new MintError(500, `${k} not configured`);
  return v;
}

/**
 * The mint pipeline (workflow-designed). Caller (route) must already have:
 * resolved `wallet` server-side, verified socials + whitelist/payment, and
 * stripped any client uri/cid/tokenId/to. This function owns: reserved gate,
 * server-side compose+pin (CIDv1), Circle mintTo, DB record.
 */
export async function mintAvatar(input: MintInput) {
  const cfg = KAWAII_GATE[input.tier];
  if (!cfg) throw new MintError(400, `unknown tier ${input.tier}`);
  const wallet = input.wallet.toLowerCase();

  // ---- 1. Resolve base + RESERVED GATE ----
  const isReserved = (RESERVED_BASE_IDS as string[]).includes(input.baseId);
  let baseFile: string;
  if (isReserved) {
    const r = RESERVED_BASES[input.baseId as keyof typeof RESERVED_BASES];
    if (r.mock) throw new MintError(423, `reserved base "${input.baseId}" is locked (owner wallet not set)`);
    if (!r.ownerWallet || r.ownerWallet.toLowerCase() !== wallet) {
      throw new MintError(403, `"${input.baseId}" is a reserved base`);
    }
    const already = await prisma.mint.findFirst({ where: { baseId: input.baseId } });
    if (already) throw new MintError(409, `reserved base "${input.baseId}" already minted`);
    const art = RESERVED_BASE_ART[input.baseId];
    if (!art) throw new MintError(501, `reserved base art for "${input.baseId}" not set yet`);
    baseFile = art;
  } else {
    if (!resolveLayerPath("base", input.baseId)) throw new MintError(400, `invalid base "${input.baseId}"`);
    baseFile = input.baseId;
  }

  // ---- 2. Server-side compose + pin (user never supplies bytes or CID) ----
  const selection: AvatarSelection = { base: baseFile, layers: input.layers };
  const png = await composeAvatar(selection);
  const imageCid = await pinImagePng(png);
  const metadata = buildMetadata({
    baseId: input.baseId,
    selection,
    imageCid,
    chainId: cfg.chainId,
    contract: cfg.nft,
    owner: wallet,
  });
  const metaCid = await pinMetadataJson(metadata as unknown as Record<string, unknown>);
  const uri = toTokenUri(metaCid); // throws unless CIDv1 ipfs://

  // ---- 3. Circle mintTo — sentinel tokenId, gas sponsored ----
  const circle = initiateDeveloperControlledWalletsClient({
    apiKey: env("CIRCLE_API_KEY"),
    entitySecret: env("CIRCLE_ENTITY_SECRET"),
  });
  const res = await circle.createContractExecutionTransaction({
    walletId: cfg.circleWalletId,
    contractAddress: cfg.nft,
    abiFunctionSignature: "mintTo(address,uint256,string,uint256)",
    abiParameters: [wallet, KAWAII_NEW_TOKEN_ID.toString(), uri, "1"],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    idempotencyKey: input.idempotencyKey,
  } as Parameters<typeof circle.createContractExecutionTransaction>[0]);
  const txId = (res.data as { id?: string })?.id;

  // ---- 4. Record (tokenId resolved later via event monitor) ----
  await prisma.mint.create({
    data: {
      address: wallet,
      baseId: input.baseId,
      chainId: cfg.chainId,
      tier: input.tier,
      txHash: txId,
      payToken: input.payToken,
      amountPaid: input.amountPaid,
      recipient: cfg.earningsRecipient,
      ipfsCid: metaCid,
    },
  });

  return { txId, ipfsCid: metaCid, imageCid, uri, reserved: isReserved };
}
