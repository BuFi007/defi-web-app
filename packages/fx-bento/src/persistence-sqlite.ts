// SQLite-backed FxBentoPersistenceStore. Mirrors the in-memory adapter in
// `./results.ts` but persists settlements + per-player allocations across
// process restarts so the API can hand out `claimPrize` calldata after
// reboot. Patterns lifted from `@bufi/db` (bun:sqlite, prepared statements,
// transactions for save flows, TEXT columns for bigint-shaped amounts).
//
// Schema:
//   bento_settlements   — one row per settlement (PK roomId)
//   bento_allocations   — many rows per settlement (PK roomId+address)
//
// We key both tables by the synthetic `id` (`${chainId}:${roomId}`) used by
// the in-memory store so chain-id collisions across forks don't blow away
// each other's payouts.

import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { Database } from "bun:sqlite";

import {
  FxBentoSettlementResultSchema,
  type FxBentoPersistenceStore,
  type FxBentoSettlementAllocation,
  type FxBentoSettlementResult,
} from "./results";

export interface CreateFxBentoSqlitePersistenceStoreOptions {
  /** Filesystem path, or `":memory:"` for an ephemeral test database. */
  dbPath: string;
}

type SettlementRow = {
  id: string;
  chain_id: number;
  room_id: string;
  status: string;
  results_root: string;
  metadata_uri: string | null;
  total_prize_payouts: string;
  protocol_fee: string;
  submit_tx_hash: string | null;
  finalization_tx_hash: string | null;
  finalized_at: string | null;
  finalized_block_number: string | null;
  created_at: string;
  updated_at: string;
};

type AllocationRow = {
  settlement_id: string;
  player: string;
  amount: string;
  score: string;
  rank: number;
  leaf: string;
  proof_json: string;
};

export function createFxBentoSqlitePersistenceStore(
  opts: CreateFxBentoSqlitePersistenceStoreOptions,
): FxBentoPersistenceStore & { close(): void } {
  const path = normalizeSqlitePath(opts.dbPath);
  ensureParentDir(path);
  const db = new Database(path, { create: true, strict: true });
  migrate(db);

  const selectSettlement = db.query<SettlementRow, [string]>(
    "select * from bento_settlements where id = ?",
  );
  const listSettlements = db.query<SettlementRow, []>(
    "select * from bento_settlements order by updated_at desc, id asc",
  );
  const selectAllocations = db.query<AllocationRow, [string]>(
    "select * from bento_allocations where settlement_id = ? order by rank asc, player asc",
  );
  const upsertSettlement = db.query(`
    insert into bento_settlements (
      id, chain_id, room_id, status, results_root, metadata_uri,
      total_prize_payouts, protocol_fee, submit_tx_hash,
      finalization_tx_hash, finalized_at, finalized_block_number,
      created_at, updated_at
    ) values (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    on conflict(id) do update set
      chain_id = excluded.chain_id,
      room_id = excluded.room_id,
      status = excluded.status,
      results_root = excluded.results_root,
      metadata_uri = excluded.metadata_uri,
      total_prize_payouts = excluded.total_prize_payouts,
      protocol_fee = excluded.protocol_fee,
      submit_tx_hash = excluded.submit_tx_hash,
      finalization_tx_hash = excluded.finalization_tx_hash,
      finalized_at = excluded.finalized_at,
      finalized_block_number = excluded.finalized_block_number,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);
  const deleteAllocations = db.query(
    "delete from bento_allocations where settlement_id = ?",
  );
  const insertAllocation = db.query(`
    insert into bento_allocations (
      settlement_id, player, amount, score, rank, leaf, proof_json
    ) values (?, ?, ?, ?, ?, ?, ?)
  `);
  const truncateSettlements = db.query("delete from bento_settlements");
  const truncateAllocations = db.query("delete from bento_allocations");

  const saveTx = db.transaction((result: FxBentoSettlementResult) => {
    upsertSettlement.run(
      result.id,
      result.chainId,
      result.roomId,
      result.status,
      result.resultsRoot,
      result.metadataURI ?? null,
      result.totalPrizePayouts,
      result.protocolFee,
      result.submitTxHash ?? null,
      result.finalizationTxHash ?? null,
      result.finalizedAt ?? null,
      result.finalizedBlockNumber ?? null,
      result.createdAt,
      result.updatedAt,
    );
    deleteAllocations.run(result.id);
    for (const allocation of result.allocations) {
      insertAllocation.run(
        result.id,
        allocation.player.toLowerCase(),
        allocation.amount,
        allocation.score,
        allocation.rank,
        allocation.leaf,
        JSON.stringify(allocation.proof),
      );
    }
  });

  const clearTx = db.transaction(() => {
    truncateAllocations.run();
    truncateSettlements.run();
  });

  function hydrate(row: SettlementRow): FxBentoSettlementResult {
    const allocations = selectAllocations.all(row.id).map(rowToAllocation);
    return FxBentoSettlementResultSchema.parse({
      id: row.id,
      chainId: row.chain_id,
      roomId: row.room_id,
      status: row.status,
      resultsRoot: row.results_root,
      metadataURI: row.metadata_uri ?? undefined,
      totalPrizePayouts: row.total_prize_payouts,
      protocolFee: row.protocol_fee,
      submitTxHash: row.submit_tx_hash ?? undefined,
      finalizationTxHash: row.finalization_tx_hash ?? undefined,
      finalizedAt: row.finalized_at ?? undefined,
      finalizedBlockNumber: row.finalized_block_number ?? undefined,
      allocations,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  return {
    async getSettlementResult(id) {
      const row = selectSettlement.get(id);
      return row ? hydrate(row) : null;
    },
    async saveSettlementResult(result) {
      saveTx(result);
      const row = selectSettlement.get(result.id);
      if (!row) throw new Error(`fx-bento sqlite: settlement ${result.id} disappeared after save`);
      return hydrate(row);
    },
    async listSettlementResults() {
      return listSettlements.all().map(hydrate);
    },
    async clearSettlementResults() {
      clearTx();
    },
    close() {
      db.close();
    },
  };
}

function rowToAllocation(row: AllocationRow): FxBentoSettlementAllocation {
  const proof = JSON.parse(row.proof_json) as string[];
  return {
    player: row.player as `0x${string}`,
    amount: row.amount,
    score: row.score,
    rank: row.rank,
    leaf: row.leaf as `0x${string}`,
    proof: proof as `0x${string}`[],
  };
}

function migrate(db: Database): void {
  db.exec(`
    pragma journal_mode = WAL;
    pragma foreign_keys = ON;

    create table if not exists bento_settlements (
      id text primary key,
      chain_id integer not null,
      room_id text not null,
      status text not null,
      results_root text not null,
      metadata_uri text,
      total_prize_payouts text not null,
      protocol_fee text not null default '0',
      submit_tx_hash text,
      finalization_tx_hash text,
      finalized_at text,
      finalized_block_number text,
      created_at text not null,
      updated_at text not null
    );

    create index if not exists idx_bento_settlements_room
      on bento_settlements (room_id);
    create index if not exists idx_bento_settlements_status
      on bento_settlements (status);

    create table if not exists bento_allocations (
      settlement_id text not null,
      player text not null,
      amount text not null,
      score text not null default '0',
      rank integer not null,
      leaf text not null,
      proof_json text not null,
      primary key (settlement_id, player),
      foreign key (settlement_id) references bento_settlements(id) on delete cascade
    );

    create index if not exists idx_bento_allocations_player
      on bento_allocations (player);
  `);
}

function normalizeSqlitePath(path: string): string {
  if (path === ":memory:") return path;
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function ensureParentDir(path: string): void {
  if (path === ":memory:") return;
  mkdirSync(dirname(path), { recursive: true });
}
