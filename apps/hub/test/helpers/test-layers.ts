import { Layer } from "effect"
import { getTableName } from "drizzle-orm"
import { Database, type ScoutDatabase } from "../../src/services/database.js"

/**
 * Creates a minimal in-memory mock of ScoutDatabase. It supports the subset
 * of the drizzle builder API that AgentManager uses:
 *   - db.insert(table).values({}).onConflictDoUpdate({}).run()
 *   - db.select().from(table).where(...).all()
 *   - db.update(table).set({}).where(...).run()
 */
function createMockDatabase(): ScoutDatabase {
  // Row storage keyed by table name → id → row
  const store = new Map<string, Map<string, Record<string, unknown>>>()

  const tableRows = (table: unknown): Map<string, Record<string, unknown>> => {
    const name = getTableName(table as Parameters<typeof getTableName>[0])
    if (!store.has(name)) store.set(name, new Map())
    return store.get(name)!
  }

  const makeInsertBuilder = (table: unknown) => {
    let _values: Record<string, unknown> = {}
    let _conflictSet: Record<string, unknown> | null = null

    return {
      values(v: Record<string, unknown>) {
        _values = v
        return this
      },
      onConflictDoUpdate(opts: { target?: unknown; set?: Record<string, unknown> }) {
        _conflictSet = opts.set ?? null
        return this
      },
      run() {
        const rows = tableRows(table)
        const id = String(_values["id"] ?? Date.now())
        const existing = rows.get(id)
        if (existing && _conflictSet) {
          rows.set(id, { ...existing, ..._conflictSet })
        } else if (!existing) {
          rows.set(id, { ..._values })
        }
        return {}
      },
    }
  }

  const makeUpdateBuilder = (table: unknown) => {
    let _set: Record<string, unknown> = {}

    return {
      set(s: Record<string, unknown>) {
        _set = s
        return this
      },
      where(_sql: unknown) {
        const rows = tableRows(table)
        for (const [id, row] of rows) {
          rows.set(id, { ...row, ..._set })
        }
        return { run: () => ({}) }
      },
      run() {
        const rows = tableRows(table)
        for (const [id, row] of rows) {
          rows.set(id, { ...row, ..._set })
        }
        return {}
      },
    }
  }

  const mock = {
    insert: (table: unknown) =>
      makeInsertBuilder(table) as unknown as ReturnType<ScoutDatabase["insert"]>,
    select: () => {
      // select() → from(table) → [where(...)] → all()
      const fromBuilder = {
        from(table: unknown) {
          const rows = () => Array.from(tableRows(table).values())
          return {
            where(_sql: unknown) {
              return { all: () => rows() }
            },
            all: () => rows(),
          }
        },
      }
      return fromBuilder as unknown as ReturnType<ScoutDatabase["select"]>
    },
    update: (table: unknown) =>
      makeUpdateBuilder(table) as unknown as ReturnType<ScoutDatabase["update"]>,
    // Stubs for unused interface members
    $client: {} as ScoutDatabase["$client"],
    query: {} as ScoutDatabase["query"],
    delete: (() => ({
      where: () => ({ run: () => ({}) }),
    })) as unknown as ScoutDatabase["delete"],
    run: (() => ({})) as unknown as ScoutDatabase["run"],
    transaction: (() => Promise.resolve({})) as unknown as ScoutDatabase["transaction"],
    execute: (() => ({})) as unknown as ScoutDatabase["execute"],
    batch: (() => Promise.resolve([])) as unknown as ScoutDatabase["batch"],
  }

  return mock as unknown as ScoutDatabase
}

/**
 * Test Database layer — provides an in-memory mock ScoutDatabase.
 * Each test suite gets a fresh store (no cross-test state leakage via Layer.sync).
 */
export const TestDatabaseLayer: Layer.Layer<Database> = Layer.sync(
  Database,
  () => createMockDatabase()
)
