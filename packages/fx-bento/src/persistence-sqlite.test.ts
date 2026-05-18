import { describe, expect, test } from "bun:test";

import { createFxBentoSqlitePersistenceStore } from "./persistence-sqlite";
import {
  configureFxBentoSettlementResultStore,
  getFxBentoClaimProof,
  getFxBentoSettlementResult,
  recordFxBentoSettlementFinalization,
  resetFxBentoSettlementResultsForTests,
  saveFxBentoSettlementResult,
  type FxBentoSettlementResult,
} from "./results";

const hex32 = (byte: string): `0x${string}` => `0x${byte.repeat(32)}`;

const player = "0x000000000000000000000000000000000000beef" as const;
const otherPlayer = "0x000000000000000000000000000000000000cafe" as const;

function settlement(overrides: Partial<FxBentoSettlementResult> = {}): FxBentoSettlementResult {
  const now = new Date(0).toISOString();
  return {
    id: "43113:42",
    chainId: 43113,
    roomId: "42",
    status: "built",
    resultsRoot: hex32("aa"),
    metadataURI: "ipfs://test",
    totalPrizePayouts: "1500",
    protocolFee: "0",
    allocations: [
      {
        player,
        amount: "1000",
        score: "5000",
        rank: 1,
        leaf: hex32("bb"),
        proof: [hex32("cc"), hex32("dd")],
      },
      {
        player: otherPlayer,
        amount: "500",
        score: "2500",
        rank: 2,
        leaf: hex32("ee"),
        proof: [hex32("ff")],
      },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("fx-bento sqlite persistence store", () => {
  test("round-trips settlement + allocations via direct store API", async () => {
    const store = createFxBentoSqlitePersistenceStore({ dbPath: ":memory:" });
    try {
      const initial = settlement();
      const saved = await store.saveSettlementResult(initial);
      expect(saved.id).toBe(initial.id);
      expect(saved.allocations).toHaveLength(2);

      const fetched = await store.getSettlementResult(initial.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.resultsRoot).toBe(hex32("aa"));
      expect(fetched?.allocations[0]?.player.toLowerCase()).toBe(player.toLowerCase());
      expect(fetched?.allocations[0]?.proof).toEqual([hex32("cc"), hex32("dd")]);
      expect(fetched?.allocations[1]?.amount).toBe("500");

      // upsert: re-save with mutated allocations should replace, not append.
      const replaced = await store.saveSettlementResult({
        ...initial,
        status: "submitted",
        allocations: [initial.allocations[0]!],
      });
      expect(replaced.status).toBe("submitted");
      expect(replaced.allocations).toHaveLength(1);

      const list = await store.listSettlementResults();
      expect(list).toHaveLength(1);

      await store.clearSettlementResults();
      expect(await store.listSettlementResults()).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("integrates with module-level result helpers (claim proof + finalize)", async () => {
    const store = createFxBentoSqlitePersistenceStore({ dbPath: ":memory:" });
    try {
      configureFxBentoSettlementResultStore({ store });
      await resetFxBentoSettlementResultsForTests();

      await saveFxBentoSettlementResult({
        chainId: 43113,
        roomId: "777",
        status: "submitted",
        resultsRoot: hex32("11"),
        totalPrizePayouts: "1000",
        allocations: [
          {
            player,
            amount: "1000",
            score: "0",
            rank: 1,
            leaf: hex32("22"),
            proof: [hex32("33")],
          },
        ],
      });

      const proofBeforeFinalize = await getFxBentoClaimProof({
        chainId: 43113,
        roomId: "777",
        player,
      });
      expect(proofBeforeFinalize?.amount).toBe("1000");
      expect(proofBeforeFinalize?.finalized).toBe(false);
      expect(proofBeforeFinalize?.proof).toEqual([hex32("33")]);

      const finalized = await recordFxBentoSettlementFinalization({
        chainId: 43113,
        roomId: "777",
        txHash: hex32("44"),
        blockNumber: 12345n,
      });
      expect(finalized.status).toBe("finalized");
      expect(finalized.finalizationTxHash).toBe(hex32("44"));
      expect(finalized.finalizedBlockNumber).toBe("12345");

      const reloaded = await getFxBentoSettlementResult({ chainId: 43113, roomId: "777" });
      expect(reloaded?.status).toBe("finalized");

      const proofAfterFinalize = await getFxBentoClaimProof({
        chainId: 43113,
        roomId: "777",
        player,
      });
      expect(proofAfterFinalize?.finalized).toBe(true);
    } finally {
      // Always restore the in-memory store so we don't leak the closed sqlite
      // handle into sibling tests.
      configureFxBentoSettlementResultStore();
      store.close();
    }
  });
});
