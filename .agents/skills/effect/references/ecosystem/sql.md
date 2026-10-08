# SQL

## Table of Contents

- [Driver Matrix](#driver-matrix)
- [Querying](#querying)
- [Transactions](#transactions)
- [Postgres Client Layer](#postgres-client-layer)
- [Cloudflare D1 Layer](#cloudflare-d1-layer)
- [Resolvers and Migrations](#resolvers-and-migrations)
- [Typed Models, Schemas, and Statements](#typed-models-schemas-and-statements)
- [Key Modules (effect/sql)](#key-modules-effectsql)
- [Notes](#notes)

**Source:** `effect/sql` - see

`~/Developer/effect/packages/effect/src/sql/`

> **API stability: `@stability unstable`.** The core SQL module is at `effect/sql`. Driver packages
> remain separate (`@effect/sql-pg`, `@effect/sql-mysql2`, etc.).

Use `effect/sql` with a driver package for your runtime/database.

## Driver Matrix

| Use case                     | Package                           | Client module      |
| ---------------------------- | --------------------------------- | ------------------ |
| Postgres (`pg`)              | `@effect/sql-pg`                  | `PgClient`         |
| MySQL (`mysql2`)             | `@effect/sql-mysql2`              | `MysqlClient`      |
| SQL Server (`tedious`)       | `@effect/sql-mssql`               | `MssqlClient`      |
| LibSQL / Turso               | `@effect/sql-libsql`              | `LibsqlClient`     |
| ClickHouse                   | `@effect/sql-clickhouse`          | `ClickhouseClient` |
| Cloudflare D1                | `@effect/sql-d1`                  | `D1Client`         |
| PGlite                       | `@effect/sql-pglite`              | `PgliteClient`     |
| SQLite (Node, `node:sqlite`) | `@effect/sql-sqlite-node`         | `SqliteClient`     |
| SQLite (Bun)                 | `@effect/sql-sqlite-bun`          | `SqliteClient`     |
| SQLite (Cloudflare DO)       | `@effect/sql-sqlite-do`           | `SqliteClient`     |
| SQLite (WASM)                | `@effect/sql-sqlite-wasm`         | `SqliteClient`     |
| SQLite (React Native)        | `@effect/sql-sqlite-react-native` | `SqliteClient`     |

Driver adapters expose `*.layer(...)` and provide `SqlClient.SqlClient`.

## Querying

```ts
import { SqlClient } from "effect/sql";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const rows = yield* sql<{ readonly id: number; readonly name: string }>`
    SELECT id, name FROM people
  `;

  return rows;
});
```

Raw statements expose `valuesUnprepared` when you need driver rows as arrays without
preparing/naming the statement first.

## Transactions

```ts
import { SqlClient } from "effect/sql";
import { Effect } from "effect";

const txProgram = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return yield* sql.withTransaction(sql`INSERT INTO people (name) VALUES (${"Arya"})`);
});
```

## Postgres Client Layer

```ts
import { PgClient } from "@effect/sql-pg";

const SqlLive = PgClient.layer({
  database: "effect_pg_dev",
});
```

## Cloudflare D1 Layer

```ts
import { D1Client } from "@effect/sql-d1";
import type { D1Database } from "@cloudflare/workers-types";

declare const DB: D1Database;

const SqlLive = D1Client.layer({
  db: DB,
});
```

## Resolvers and Migrations

- Resolver constructors: `SqlResolver.ordered`, `SqlResolver.findById`, `SqlResolver.grouped`
- `SqlResolver.findById` deduplicates concurrent requests for the same ID before batching to the
  database
- Migrators: `Migrator.make` (core), plus driver migrators such as `PgMigrator`, `SqliteMigrator`,
  `MssqlMigrator`, `LibsqlMigrator`, `ClickhouseMigrator`

## Typed Models, Schemas, and Statements

For schema-first CRUD, define a `Model.Class` under `effect/schema` and pass it to
`SqlModel.makeRepository(Model, { tableName, spanPrefix, idColumn })`. The repository exposes typed
`insert`, `update`, `findById`, and `delete` operations; `makeResolvers` derives batched request
resolvers for the same model. Add `softDeleteColumn` when deletes should become timestamp updates.

For smaller queries, `SqlSchema.findAll`, `findNonEmpty`, `findOne`, `findOneOption`, and `void`
encode requests and decode returned rows around an `execute` function; `void` only encodes the
request and discards the execution result. The `Statement` constructor is the parameterized tagged
template; use its `insert`, `update`, `in`, `and`, `or`, `csv`, and `onDialect` helpers to compose
safe fragments. The tagged-template constructor is exposed by the `SqlClient.SqlClient` service,
while `Statement` exports the underlying builder types and helpers. Reserve `unsafe` and `literal`
for deliberately raw, audited SQL.

## Key Modules (effect/sql)

| Module          | What it provides                           |
| --------------- | ------------------------------------------ |
| `SqlClient`     | SQL client service (`SqlClient.SqlClient`) |
| `SqlConnection` | Raw connection access                      |
| `SqlError`      | SQL error types                            |
| `SqlModel`      | Model helpers                              |
| `SqlSchema`     | Schema integration for query results       |
| `SqlResolver`   | Typed resolvers from table schemas         |
| `SqlStream`     | Streaming query results                    |
| `Migrator`      | Migration runner                           |
| `Statement`     | Raw statement builder                      |

## Notes

- D1 does not support SQL transactions; design your D1 workflows accordingly.
- In v4, the core SQL module (`SqlClient`, `SqlResolver`, `Migrator`) moved from `@effect/sql` to
  `effect/sql`. Driver packages (`@effect/sql-pg`, `@effect/sql-mysql2`, etc.) remain separate.
- Keep driver package versions aligned with `effect/sql`.
- `@effect/sql-pg` is backed by a native PostgreSQL wire-protocol client. Use `PgClient.make` for a
  pooled client or `PgClient.makeClient` for one connection; `PgConnection` exposes a single session
  and `PgPool` owns pool lifecycle (`PgPool.make`, plus `reserve` for exclusive access to one
  concurrent item). Use `PgProtocol` and `PgTypes` for lower-level codec work. Prepared statements
  are enabled by default, multiplexing is optional, and `listen` returns a scoped `Queue.Dequeue`.
- Plain object parameters are no longer inferred as JSON. Wrap JSON values with `sql.json(value)`
  (or `PgClient.json`) and keep `PgClientConfig.types` as a `PgTypes.Registry`. The binary codecs
  change result types: `int8` → `bigint`, timestamps → `Date`, `date` → string, and `bytea`/unknown
  OIDs → `Uint8Array`.
- `SqlClient.reactive` and `SqlClient.reactiveMailbox` integrate query invalidation with the
  `effect/reactivity` module; use them when reads should refresh from changed keys instead of
  polling.
