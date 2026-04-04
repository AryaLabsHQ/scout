import { Config, Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { Database as BunDatabase } from "bun:sqlite"
import * as schema from "../../drizzle/schema.js"

export type ScoutDatabase = ReturnType<typeof drizzle<typeof schema>>

export class Database extends ServiceMap.Service<Database, ScoutDatabase>()(
  "@scout/Database",
  {
    make: Effect.gen(function* () {
      const dbPath = yield* Config.withDefault(Config.string("SCOUT_DB_PATH"), "./scout.db")

      const db = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const sqlite = new BunDatabase(dbPath)
          return drizzle(sqlite, { schema })
        }),
        (db) =>
          Effect.sync(() => {
            db.$client.close()
          }),
      )

      // Enable WAL mode and foreign keys
      yield* Effect.sync(() => {
        try {
          db.$client.exec("PRAGMA journal_mode=WAL")
        } catch {
          // In-memory DBs may not support WAL — ignore
        }
        db.$client.exec("PRAGMA foreign_keys=ON")
      })

      return db
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
