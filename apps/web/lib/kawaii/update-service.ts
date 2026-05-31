import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { createHash } from "node:crypto";
import { createPublicClient, http, parseAbiItem, decodeEventLog } from "viem";
import { arcTestnet } from "viem/chains";
import { prisma } from "../prisma";
import { KAWAII_GATE, RESERVED_BASES, RESERVED_BASE_IDS } from "./config";
import { composeAvatar, selectionKey, type AvatarSelection } from "./compose";
import { resolveLayerPath } from "./layers";
import { pinImagePng, pinMetadataJson, toTokenUri } from "./pin";
import { buildMetadata } from "./metadata";
import { MintError } from "./mint-service";

/** Circle requires a UUID-format idempotencyKey; derive one deterministically. */
function toUuid(s: string): string {
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function env(k: string): string {
  const v = process.env[k];
  if (!v) throw new MintError(500, `${k} not configured`);
  return v;
}

export interface UpdateInput {
  wallet: string; // session-resolved owner (never from request body)
  tier: "testnet";
  baseId: string; // new chosen base (reserved key OR open base filename)
  layers?: AvatarSelection["layers"]; // new equipped traits {category: filename}
  tokenId: string; // the holder's ERC-1155 token id (from our ledger, not the client)
}

// Reserved baseId → its dedicated art filename. Mirrors mint-service (none set yet).
const RESERVED_BASE_ART: Partial<Record<string, string>> = {};

/**
 * Re-skin an already-minted Kawaii Punk: re-compose the avatar from the chosen
 * base + traits (using the NFT variants), re-pin image + metadata to IPFS, and
 * call `setTokenURI` on the ERC-1155 via the Circle mint authority. Updates the
 * ledger row's baseId + ipfsCid. Auth/ownership is enforced by the route.
 */
export async function updateAvatar(input: UpdateInput) {
  const cfg = KAWAII_GATE[input.tier];
  if (!cfg || input.tier !== "testnet") throw new MintError(400, `unsupported tier ${input.tier}`);
  const wallet = input.wallet.toLowerCase();
  if (!/^\d+$/.test(input.tokenId)) throw new MintError(400, "missing/invalid tokenId");

  // ---- 1. Resolve base (+ reserved gate, identical to mint) ----
  const isReserved = (RESERVED_BASE_IDS as string[]).includes(input.baseId);
  let baseFile: string;
  if (isReserved) {
    const r = RESERVED_BASES[input.baseId as keyof typeof RESERVED_BASES];
    if (r.mock) throw new MintError(423, `reserved base "${input.baseId}" is locked`);
    if (!r.ownerWallet || r.ownerWallet.toLowerCase() !== wallet) throw new MintError(403, `"${input.baseId}" is a reserved base`);
    const art = RESERVED_BASE_ART[input.baseId];
    if (!art) throw new MintError(501, `reserved base art for "${input.baseId}" not set yet`);
    baseFile = art;
  } else {
    if (!resolveLayerPath("base", input.baseId)) throw new MintError(400, `invalid base "${input.baseId}"`);
    baseFile = input.baseId;
  }

  // ---- 2. Re-compose with positioned NFT variants + re-pin ----
  // composeAvatar defaults traits to their positioned variant; the base is the
  // full-body image. metadata attributes keep the canonical selection.
  const canonical: AvatarSelection = { base: baseFile, layers: input.layers };
  const png = await composeAvatar(canonical, { traitVariant: "nft" });
  const imageCid = await pinImagePng(png);
  const metadata = buildMetadata({
    baseId: input.baseId,
    selection: canonical,
    imageCid,
    chainId: cfg.chainId,
    contract: cfg.nft,
    owner: wallet,
  });
  const metaCid = await pinMetadataJson(metadata as unknown as Record<string, unknown>);
  const uri = toTokenUri(metaCid); // throws unless CIDv1 ipfs://

  // ---- 3. setTokenURI on the ERC-1155 (Circle mint authority, gas sponsored) ----
  const circle = initiateDeveloperControlledWalletsClient({
    apiKey: env("CIRCLE_API_KEY"),
    entitySecret: env("CIRCLE_ENTITY_SECRET"),
  });
  const res = await circle.createContractExecutionTransaction({
    walletId: cfg.circleWalletId,
    contractAddress: cfg.nft,
    abiFunctionSignature: "setTokenURI(uint256,string)",
    abiParameters: [input.tokenId, uri],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    idempotencyKey: toUuid(`update:${wallet}:${input.tokenId}:${selectionKey(canonical)}`),
  } as Parameters<typeof circle.createContractExecutionTransaction>[0]);
  const txId = (res.data as { id?: string })?.id;

  // ---- 4. Update the ledger row (latest mint for this wallet) ----
  const existing = await prisma.mint.findFirst({ where: { address: wallet, tokenId: input.tokenId }, orderBy: { createdAt: "desc" } });
  if (existing) {
    await prisma.mint.update({ where: { id: existing.id }, data: { baseId: input.baseId, ipfsCid: metaCid } });
  }

  return { txId, ipfsCid: metaCid, imageCid, uri };
}

/**
 * Poll a Circle contract-execution transaction's state (the setTokenURI tx is
 * async). Returns the raw Circle state + the on-chain hash once available.
 * Circle states: QUEUED → SENT → CONFIRMED → COMPLETE (success); FAILED /
 * CANCELLED / DENIED (terminal failure).
 */
export async function getUpdateTxStatus(txId: string): Promise<{ state: string; txHash: string | null }> {
  const circle = initiateDeveloperControlledWalletsClient({
    apiKey: env("CIRCLE_API_KEY"),
    entitySecret: env("CIRCLE_ENTITY_SECRET"),
  });
  const res = await circle.getTransaction({ id: txId });
  const tx = (res.data as { transaction?: { state?: string; txHash?: string } })?.transaction;
  return { state: (tx?.state ?? "UNKNOWN").toUpperCase(), txHash: tx?.txHash ?? null };
}

const TRANSFER_SINGLE = parseAbiItem(
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
);

/**
 * Resolve a mint's ERC-1155 tokenId on demand (no event monitor runs, so the
 * ledger row's tokenId is usually null). The stored `txHash` is the CIRCLE tx
 * id → resolve the on-chain hash → read the receipt → parse the TransferSingle
 * `id`. Returns null if the mint tx isn't mined / resolvable yet.
 */
export async function resolveMintTokenId(mint: { tokenId: string | null; txHash: string | null }): Promise<string | null> {
  if (mint.tokenId) return mint.tokenId;
  if (!mint.txHash) return null;
  let onchain: string | null = null;
  try {
    ({ txHash: onchain } = await getUpdateTxStatus(mint.txHash));
  } catch { return null; }
  if (!onchain) return null;
  try {
    const pc = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL || arcTestnet.rpcUrls.default.http[0]) });
    const receipt = await pc.getTransactionReceipt({ hash: onchain as `0x${string}` });
    for (const log of receipt.logs) {
      try {
        const dec = decodeEventLog({ abi: [TRANSFER_SINGLE], data: log.data, topics: log.topics });
        if (dec.eventName === "TransferSingle") return (dec.args as { id: bigint }).id.toString();
      } catch { /* not this log */ }
    }
  } catch { return null; }
  return null;
}
