import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { Database } from "../../src/services/database.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"
import { systems } from "../../drizzle/schema.js"

const run = <A>(effect: Effect.Effect<A, unknown, Database>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestDatabaseLayer)))

describe("Database service", () => {
  it("provides a drizzle db instance", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* Database
        expect(db).toBeDefined()
        expect(typeof db.select).toBe("function")
        expect(typeof db.insert).toBe("function")
      }),
    )
  })

  it("has foreign keys enabled", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* Database
        const result = db.$client
          .prepare("PRAGMA foreign_keys")
          .get() as { foreign_keys: number }
        expect(result.foreign_keys).toBe(1)
      }),
    )
  })

  it("can insert and query a row", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* Database
        const now = new Date()

        db.insert(systems)
          .values({
            id: "sys-test-001",
            hostname: "test-host",
            status: "online",
            lastSeen: now,
            createdAt: now,
          })
          .run()

        const rows = db.select().from(systems).all()
        expect(rows).toHaveLength(1)
        expect(rows[0].id).toBe("sys-test-001")
        expect(rows[0].hostname).toBe("test-host")
        expect(rows[0].status).toBe("online")
      }),
    )
  })

  it("WAL mode is set or gracefully ignored (in-memory may not support it)", async () => {
    // In-memory SQLite databases return 'memory' for journal_mode=WAL
    // The database service handles this gracefully
    await run(
      Effect.gen(function* () {
        const db = yield* Database
        const result = db.$client
          .prepare("PRAGMA journal_mode")
          .get() as { journal_mode: string }
        // In-memory SQLite returns 'memory', file-based returns 'wal'
        expect(["memory", "wal"]).toContain(result.journal_mode)
      }),
    )
  })
})
