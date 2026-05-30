import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { ARC_CHAIN_ID } from "../shared.ts";
import { hasIdentity, buildRegisterCalldata, IDENTITY_REGISTRY } from "../erc8004.ts";

/**
 * Kawaii Punks mint — the agent path. Ties the ERC-8004 agent identity (already
 * served by the reputation/* tools) to the Kawaii avatar NFT so an agent's mint
 * is an AGENTIC NFT: it carries the agent badge (agentId) + reputation.
 *
 * This is a PLAN tool (the bufi-hyper convention: return the calls to sign, not
 * a server-executed tx). It returns, in order:
 *   1. identity — register your ERC-8004 identity first if you don't have one
 *      (you sign register(string) → you OWN the identity, not us).
 *   2. payment  — USDC on Arc Testnet to the earnings agent.
 *   3. mint     — sign the intent + POST to the web mint with your agentId.
 *      The web verifies you own that agentId on-chain, links it to the Punk,
 *      and returns the badge. Agents SKIP social verification (the identity is
 *      the proof — humans use Guild socials instead).
 */
const WEB = process.env.KAWAII_WEB_URL || "https://fx.bu.finance";
const ARC_USDC = "0x3600000000000000000000000000000000000000"; // native USDC on Arc (6-dec ERC20)
const EARNINGS = "0xb79e4987bC58057a322cd9bcfAce4944DD6a6cc7"; // testnet agent SCA
const PRICE_USDC = "10000000"; // 10 USDC (6 dec) — testnet sandbox price

const mintKawaii = route
  .post("/kawaii/mint")
  .body(
    z.object({
      address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      baseId: z.string().max(128).optional(),
      name: z.string().max(64).optional(),
    }),
  )
  .meta({
    mcp: {
      title: "Mint a Kawaii Punk (agent)",
      description:
        "Plan an agentic Kawaii Punk mint on Arc. Returns the steps to (1) register your ERC-8004 identity if missing, (2) pay USDC, (3) sign + POST the mint with your agentId so the Punk carries your agent badge + reputation. Agents skip social verification — your on-chain identity is the proof. Browse bases via the catalog URL returned.",
    },
  })
  .handle(async ({ body }) => {
    const address = body.address as `0x${string}`;
    const registered = await hasIdentity(address);
    const identity = registered
      ? { registered: true as const, note: "You hold an ERC-8004 identity. Pass its agentId in the mint body to link the agent badge." }
      : {
          registered: false as const,
          note: "Register first so you OWN your ERC-8004 identity, then read your agentId from get__api_reputation_identity / the Transfer event, and pass it in the mint body.",
          registerCall: (() => {
            const c = buildRegisterCalldata(
              JSON.stringify({ name: body.name ?? `Agent-${address.slice(0, 8)}`, type: "agent", source: "kawaii", platform: "bufi-hyper" }),
            );
            return { to: c.to, function: c.functionSignature, args: c.args };
          })(),
        };

    return ok({
      base: body.baseId ?? null,
      catalog: `${WEB}/api/kawaii/catalog`,
      identity,
      payment: { token: "USDC", amount: PRICE_USDC, decimals: 6, to: EARNINGS, usdc: ARC_USDC, chainId: ARC_CHAIN_ID },
      mint: {
        endpoint: `${WEB}/api/kawaii/mint`,
        method: "POST",
        // Real newlines (\n) separate the 4 lines — the web reconstructs this EXACT
        // string and verifies the signature, so a mismatched separator → 401.
        intentMessage: "Kawaii Punk mint\nwallet:{address}\nbase:{baseId}\ndeadline:{deadline}\nnonce:{nonce}",
        intentMessageFormat: {
          note: "Build the message with LITERAL newline (U+000A) separators — NOT the 2-char sequence backslash-n. Lowercase {address}. {deadline} = unix seconds, ~now+600. {nonce} = a uuid. Sign that exact UTF-8 string (personal_sign / EIP-191).",
          example: "Kawaii Punk mint\nwallet:0xabc...123\nbase:base_neutral_ghost_blue.png\ndeadline:1780151700\nnonce:6f1c...e9",
        },
        body: ["wallet", "baseId", "deadline", "nonce", "signature", "paymentTx", "agentId"],
        note: "Reconstruct intentMessage with real newlines, sign it, send the USDC payment, then POST all body fields. Include your ERC-8004 agentId → the web verifies ownerOf(agentId)==wallet, links it to the Punk, and returns the agent badge { agentId, reputation }. Agents skip social verification.",
      },
      registries: { identity: IDENTITY_REGISTRY, chainId: ARC_CHAIN_ID },
    });
  });

export default new Hyper({ prefix: "/api" }).use([mintKawaii]);
