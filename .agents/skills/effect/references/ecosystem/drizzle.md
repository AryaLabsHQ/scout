# Drizzle ORM (effect-postgres)

## Table of Contents

- [When to use](#when-to-use)
- [Install](#install)
- [Schema with `defineRelations`](#schema-with-definerelations)
- [Wiring the Db service](#wiring-the-db-service)
- [Querying](#querying)
- [Migrations](#migrations)
- [Custom logging](#custom-logging)
- [Typed errors](#typed-errors)
- [Notes & caveats](#notes--caveats)
- [See also](#see-also)

Drizzle 1.0 ships first-class Effect-TS support via

`drizzle-orm/effect-postgres`. The integration uses `@effect/sql-pg`'s `PgClient` as the underlying
connection and exposes a typed Drizzle query builder as a Context service. Use this when you want
Drizzle's schema/query DX with Effect's resource management, structured concurrency, and tracing.

**Source:** `drizzle-orm/effect-postgres/driver.ts` (`EffectPgDatabase`, `make`, `makeWithDefaults`,
`DefaultServices`) - see `~/Developer/drizzle-orm/drizzle-orm/src/effect-postgres/driver.ts`
**Source:** `drizzle-orm/effect-postgres/session.ts` (`EffectPgSession`) - see
`~/Developer/drizzle-orm/drizzle-orm/src/effect-postgres/session.ts` **Source:**
`drizzle-orm/effect-postgres/migrator.ts` (`migrate`) - see
`~/Developer/drizzle-orm/drizzle-orm/src/effect-postgres/migrator.ts` **Source:**
`drizzle-orm/effect-core/logger.ts` (`EffectLogger`) - see
`~/Developer/drizzle-orm/drizzle-orm/src/effect-core/logger.ts` **Source:**
`drizzle-orm/effect-core/errors.ts` (`EffectDrizzleQueryError`, `MigratorInitError`) - see
`~/Developer/drizzle-orm/drizzle-orm/src/effect-core/errors.ts` **Source:**
`drizzle-orm/relations.ts` (`defineRelations`) - see
`~/Developer/drizzle-orm/drizzle-orm/src/relations.ts:1619` **Source:**
`drizzle-orm/pg-core/casing.ts` (`snakeCase`, `camelCase`) - see
`~/Developer/drizzle-orm/drizzle-orm/src/pg-core/casing.ts:5` **Source:** `@effect/sql-pg`
(`PgClient`, `PgClient.layerConfig`) - see `~/Developer/effect/packages/sql/pg/src/PgClient.ts:74`

Verified against `drizzle-orm@1.0.0-rc.4` and `@effect/sql-pg` on the skill's baseline `effect` line
(see [v4-beta-deltas.md](v4-beta-deltas.md)).

## When to use

In an Effect codebase, the Effect-native Drizzle integration is required for Postgres persistence.
Use `drizzle-orm/effect-postgres` with `@effect/sql-pg`; do not use promise-based Drizzle drivers
and wrap queries in `Effect.tryPromise` as the application persistence pattern.

Use this integration when:

- You want Drizzle's schema-first DX (`pgTable`, relations) with Effect's structured concurrency and
  tracing.
- You're already using `@effect/sql-pg` and want a query builder layered on top.
- You need typed errors (`EffectDrizzleQueryError`) instead of thrown exceptions.

If the application is not using Effect, use `drizzle-orm/node-postgres` directly.
`Effect.tryPromise` is still appropriate at real foreign async boundaries where no Effect-native
integration exists, or inside integration-layer code that adapts a Promise API into an Effect-native
public surface.

## Install

```bash
bun add --exact drizzle-orm @effect/sql-pg@4.0.0 effect@4.0.0
# Keep effect and @effect/sql-pg on the same version.
```

The `effect-postgres` entry is exported from the same `drizzle-orm` package — no extra install.

## Schema with `defineRelations`

Drizzle 1.0 introduces `defineRelations` (the v2 relations API). It separates table definitions from
the relation graph, which keeps tables free of cyclic imports and gives the runtime a single
relation registry.

```ts
import { defineRelations } from "drizzle-orm";
import * as D from "drizzle-orm/pg-core";

// `D.snakeCase.table(...)` automatically converts camelCase columns
// to snake_case at the SQL layer.
export const usersTable = D.snakeCase.table("users", {
  id: D.serial().primaryKey(),
  name: D.text().notNull(),
});

export const postsTable = D.snakeCase.table("posts", {
  id: D.serial().primaryKey(),
  authorId: D.integer()
    .notNull()
    .references(() => usersTable.id),
  title: D.text().notNull(),
});

export const relations = defineRelations({ posts: postsTable, users: usersTable }, (r) => ({
  posts: {
    author: r.one.users({
      from: r.posts.authorId,
      to: r.users.id,
      optional: false,
    }),
  },
  users: {
    posts: r.many.posts(),
  },
}));
```

`D.snakeCase`, `D.camelCase` are casing-aware factories exported per dialect — for SQLite use
`drizzle-orm/sqlite-core`, for MySQL `drizzle-orm/mysql-core`, etc. They wrap the regular
`pgTable`/`sqliteTable` and apply the casing strategy to all column names.

## Wiring the Db service

`PgDrizzle.make({ relations })` is an `Effect.fn` that needs three services in scope:

- `PgClient` (from `@effect/sql-pg`) — the actual connection
- `EffectLogger` — pluggable query logger; `EffectLogger.Default` is a no-op
- `EffectCache` — pluggable query cache; default is a no-op

`PgDrizzle.DefaultServices` is a layer that provides the no-op logger and cache. You still need to
provide `PgClient` yourself.

```ts
import { BunRuntime } from "@effect/platform-bun";
import { PgClient } from "@effect/sql-pg";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Config, Context, Effect, Layer } from "effect";
import { relations, usersTable } from "./schema";

// Connection layer — reads PG_URL from Config (redacted)
const Pg = PgClient.layerConfig({
  url: Config.Redacted("PG_URL"),
});

// Define a Db service. The `make` option is an Effect that produces the
// service implementation, so PgDrizzle.make can be used directly.
export class Db extends Context.Service<Db>()("Db", {
  make: PgDrizzle.make({ relations }),
}) {
  static layer = Layer.effect(this, this.make).pipe(
    Layer.provide(PgDrizzle.DefaultServices),
    Layer.provide(Pg),
  );
}

const program = Effect.gen(function* () {
  const db = yield* Db;
  const users = yield* db.select().from(usersTable);
  for (const user of users) {
    yield* Effect.log(user.id);
  }
});

BunRuntime.runMain(program.pipe(Effect.provide(Db.layer)));
```

Why `Context.Service<Db>()("Db", { make })`? The `make` option lets the service constructor be an
Effect that pulls its own dependencies (`PgClient`, `EffectLogger`, `EffectCache`) from the layer
graph. You then materialize the service into a `Layer.effect` and provide its dependencies once, at
the top.

For a quick prototype that doesn't need custom logging or caching:

```ts
const db = yield * PgDrizzle.makeWithDefaults({ relations });
// equivalent to: PgDrizzle.make({ relations }).pipe(Effect.provide(PgDrizzle.DefaultServices))
```

## Querying

The returned `db` exposes the standard Drizzle PG query builder, but every method returns an
`Effect` (with `EffectDrizzleQueryError` in the error channel) instead of a thenable.

```ts
const program = Effect.gen(function* () {
  const db = yield* Db;

  // SELECT — returns Effect<Row[], EffectDrizzleQueryError>
  const users = yield* db.select().from(usersTable);

  // INSERT … RETURNING
  const [created] = yield* db.insert(usersTable).values({ name: "Arya" }).returning();

  // Relational query (uses defineRelations registry)
  const usersWithPosts = yield* db.query.users.findMany({
    with: { posts: true },
  });

  // Transactions — Drizzle's transaction takes an Effect callback
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      yield* tx.insert(postsTable).values({ authorId: created.id, title: "hi" });
      // any failure here rolls back; success commits
    }),
  );
});
```

## Migrations

```ts
import { migrate } from "drizzle-orm/effect-postgres/migrator";

const runMigrations = Effect.gen(function* () {
  const db = yield* Db;
  yield* migrate(db, { migrationsFolder: "./drizzle" });
});
```

`migrate` reads files via Drizzle's `readMigrationFiles` and runs them through `coreMigrate` against
`db.session`. Failures are typed as `MigratorInitError` (see
`drizzle-orm/effect-core/errors.ts:38`).

## Custom logging

Three options:

```ts
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Layer } from "effect";

// 1. No-op (default)
const layer1 = PgDrizzle.DefaultServices;

// 2. Effect.log-based query logger (logs every query with annotations)
const layer2 = Layer.merge(PgDrizzle.DefaultServices, PgDrizzle.EffectLogger.layer);

// 3. Bridge an existing Drizzle Logger (e.g. from drizzle-orm/logger)
const layer3 = Layer.merge(
  PgDrizzle.DefaultServices,
  PgDrizzle.EffectLogger.layerFromDrizzle(myDrizzleLogger),
);
```

`EffectLogger.layer` annotates each `Effect.log` call with `{ query, params }`, so it integrates
with the rest of your tracing setup (OpenTelemetry, OTLP, etc.).

## Typed errors

```ts
import { Effect } from "effect";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";

const safeQuery = program.pipe(
  Effect.catchTag("EffectDrizzleQueryError", (e) =>
    Effect.gen(function* () {
      yield* Effect.logError("query failed", { query: e.query, params: e.params });
      return [];
    }),
  ),
);
```

`EffectDrizzleQueryError` is a `Schema.TaggedError` with `query: string`, `params: unknown[]`,
`cause: unknown`. Always handle it at the boundary where you can either retry, fall back, or surface
a domain error.

## Notes & caveats

- **Casing helpers are per dialect.** `drizzle-orm/pg-core` exports `snakeCase`, `camelCase`; the
  same pattern repeats for `sqlite-core`, `mysql-core`, `mssql-core`, `singlestore-core`,
  `cockroach-core`. Don't import from a different dialect than your tables.
- **`defineRelations` replaces the old per-table `relations(table, ...)` API.** Mixing both in the
  same project is allowed but discouraged — pick one.
- **`@effect/sql-pg` peer-deps.** Drizzle 1.0 requires
  `@effect/sql-pg >= 4.0.0-beta.58 || >= 4.0.0`. Check
  `~/Developer/drizzle-orm/drizzle-orm/package.json` `peerDependencies` for the exact bound.
- **Driver-side codecs.** `effectPgCodecs` (in `drizzle-orm/effect-postgres/codecs.ts`) is the
  default codec set. Override with `make({ relations, codecs: customCodecs })` if you need custom
  type mapping.
- **Drizzle's `make` is `Effect.fn('PgDrizzle.make')`** — it appears in fiber dumps and OTel spans
  by that name.

## See also

- [sql.md](sql.md) — the underlying `effect/sql` (`@effect/sql-pg`) layer
- [service.md](../dependency-injection/service.md) — `Context.Service<Self>()(name, { make })`
  pattern with effectful constructor
- [observability.md](../core/observability.md) — wiring `EffectLogger.layer` into OpenTelemetry
