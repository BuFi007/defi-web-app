/**
 * Kawaii gate whitelist seed — append addresses here over time, re-run safely
 * (upserts). Run: `bun run prisma/seed.ts` (needs DATABASE_URL in apps/web/.env).
 *
 * tier: "testnet" (Arc test NFT only) | "mainnet" (real Avalanche NFT) | "both".
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Append rows here. First = owner (for testing). Tower/Arc/Avax beta testers go below.
const WHITELIST: Array<{ address: string; tier?: "testnet" | "mainnet" | "both"; source?: string; note?: string }> = [
  { address: "0xcA02Be6cDBb806d4a327FC92E094D1A44EC37445", tier: "both", source: "owner", note: "founder / first whitelist" },
  { address: "0x0862fc730cd52f68d01bae4b957be503e8d983a2", tier: "both", source: "team", note: "william" },
  { address: "0xffdB0DfD58457326d40E82F3B3a9401083A39E83", tier: "testnet", source: "team", note: "e2e test wallet" },
  // { address: "0x...", tier: "both", source: "tower", note: "Tower Exchange top trader" },
];

async function main() {
  for (const w of WHITELIST) {
    const address = w.address.toLowerCase();
    await prisma.gateWhitelist.upsert({
      where: { address },
      update: { tier: w.tier ?? "both", source: w.source, note: w.note },
      create: { address, tier: w.tier ?? "both", source: w.source, note: w.note },
    });
    console.log(`whitelisted ${address} (${w.tier ?? "both"}, ${w.source ?? "-"})`);
  }

  const count = await prisma.gateWhitelist.count();
  console.log(`gate_whitelist rows: ${count}`);

  // Safety: confirm the pre-existing Bento worker table is intact (we never touch it).
  const [bento] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM fx_bento_worker_jobs`,
  ).catch(() => [{ n: -1n }]);
  console.log(`fx_bento_worker_jobs rows (must still be ~10): ${bento?.n}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
