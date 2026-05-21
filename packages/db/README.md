# @bufi/db

Database contracts for BUFI backend services (`apps/api`, keepers,
server-side code in `apps/web`). Adapter-agnostic interfaces with two
concrete implementations.

## Adapters

| Adapter      | Status         | When                                                |
| ------------ | -------------- | --------------------------------------------------- |
| `bun:sqlite` | Production     | Default. Single-process local file or `:memory:`.   |
| `postgres`   | Scaffolded     | Future. Multi-instance keepers, durable shared state. |

Sqlite is the current production adapter. Postgres has typed signatures and
DDL but every method throws `postgres adapter: <name> not yet implemented` —
ready for a follow-up PR to fill in.

## Selecting an adapter

Default behavior is unchanged: omit `DATABASE_URL`, optionally set
`BUFI_DB_PATH`, and you get sqlite.

```sh
# sqlite (default)
unset DATABASE_URL
export BUFI_DB_PATH=.bufi/trading-machine.sqlite

# sqlite via DATABASE_URL
export DATABASE_URL=sqlite:///var/bufi/trading-machine.sqlite

# postgres (future)
export DATABASE_URL=postgres://bufi:bufi@localhost:5432/bufi
```

The env router lives in `createTradingMachineDbFromEnv` (`src/index.ts`):
any URL starting with `postgres://` / `postgresql://` routes to Postgres;
everything else (including unset) routes to sqlite.

## Why an abstraction

Sqlite is great for single-process local dev and for keepers that run as a
single replica. Production needs multiple keeper instances writing
concurrently — sqlite serializes writers and we will hit head-of-line
blocking under fan-out load. Postgres gives us real concurrent writers,
row-level locks, and a managed surface for backups.

The abstraction lets us stage the migration: ship the adapter scaffold now,
flip `DATABASE_URL` later without touching call sites.

## Direct adapter imports

For callers that want to sidestep env routing:

```ts
import { createSqliteTradingMachineDb } from "@bufi/db/adapters/sqlite";
import { createPostgresTradingMachineDb } from "@bufi/db/adapters/postgres";
```

`pg` is an optional peer dependency — only install it in apps that use the
Postgres adapter (`bun add pg @types/pg`).
