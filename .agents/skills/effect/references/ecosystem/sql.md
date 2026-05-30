# SQL

**Source:** `effect/unstable/sql` - see `~/Developer/effect/packages/effect/src/unstable/sql/`

> **Unstable in v4.** The core SQL module is at `effect/unstable/sql`. Driver packages remain separate (`@effect/sql-pg`, `@effect/sql-mysql2`, etc.).

Use `effect/unstable/sql` with a driver package for your runtime/database.

## Driver Matrix

| Use case | Package | Client module |
|----------|---------|---------------|
| Postgres (`postgres.js`) | `@effect/sql-pg` | `PgClient` |
| MySQL (`mysql2`) | `@effect/sql-mysql2` | `MysqlClient` |
| SQL Server (`tedious`) | `@effect/sql-mssql` | `MssqlClient` |
| LibSQL / Turso | `@effect/sql-libsql` | `LibsqlClient` |
| ClickHouse | `@effect/sql-clickhouse` | `ClickhouseClient` |
| Cloudflare D1 | `@effect/sql-d1` | `D1Client` |
| SQLite (Node, `better-sqlite3`) | `@effect/sql-sqlite-node` | `SqliteClient` |
| SQLite (Bun) | `@effect/sql-sqlite-bun` | `SqliteClient` |
| SQLite (Cloudflare DO) | `@effect/sql-sqlite-do` | `SqliteClient` |
| SQLite (WASM) | `@effect/sql-sqlite-wasm` | `SqliteClient` |
| SQLite (React Native) | `@effect/sql-sqlite-react-native` | `SqliteClient` |

Driver adapters expose `*.layer(...)` and provide `SqlClient.SqlClient`.

## Querying

```ts
import { SqlClient } from "effect/unstable/sql"
import { Effect } from "effect"

const program = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  const rows = yield* sql<{ readonly id: number; readonly name: string }>`
    SELECT id, name FROM people
  `

  return rows
})
```

## Transactions

```ts
import { SqlClient } from "effect/unstable/sql"
import { Effect } from "effect"

const txProgram = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  return yield* sql.withTransaction(
    sql`INSERT INTO people (name) VALUES (${"Arya"})`
  )
})
```

## Postgres Client Layer

```ts
import { PgClient } from "@effect/sql-pg"

const SqlLive = PgClient.layer({
  database: "effect_pg_dev"
})
```

## Cloudflare D1 Layer

```ts
import { D1Client } from "@effect/sql-d1"
import type { D1Database } from "@cloudflare/workers-types"

declare const DB: D1Database

const SqlLive = D1Client.layer({
  db: DB
})
```

## Resolvers and Migrations

- Resolver constructors: `SqlResolver.ordered`, `SqlResolver.findById`, `SqlResolver.grouped`
- Migrators: `Migrator.make` (core), plus driver migrators such as `PgMigrator`, `SqliteMigrator`, `MssqlMigrator`, `LibsqlMigrator`, `ClickhouseMigrator`

## Key Modules (effect/unstable/sql)

| Module | What it provides |
|--------|-----------------|
| `SqlClient` | SQL client service (`SqlClient.SqlClient`) |
| `SqlConnection` | Raw connection access |
| `SqlError` | SQL error types |
| `SqlModel` | Model helpers |
| `SqlSchema` | Schema integration for query results |
| `SqlResolver` | Typed resolvers from table schemas |
| `SqlStream` | Streaming query results |
| `Migrator` | Migration runner |
| `Statement` | Raw statement builder |

## Notes

- D1 does not support SQL transactions; design your D1 workflows accordingly.
- In v4, the core SQL module (`SqlClient`, `SqlResolver`, `Migrator`) moved from `@effect/sql` to `effect/unstable/sql`. Driver packages (`@effect/sql-pg`, `@effect/sql-mysql2`, etc.) remain separate and are unchanged.
- Keep driver package versions aligned with `effect/unstable/sql`.
