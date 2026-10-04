import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Database, type Statement } from "bun:sqlite"
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@earendil-works/pi-durable/storage/sqlite"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"

/**
 * pi-durable's portable SQLite core over `bun:sqlite`.
 *
 * bun:sqlite is synchronous; the facade contract is asynchronous and requires that a running
 * transaction holds the connection: unrelated operations and other transactions queue behind it.
 * This mirrors pi-durable's own `node:sqlite` adapter (storage/sqlite/node.ts).
 */

type TransactionScope = { active: boolean }

const ignore = (): void => {}

/** Runs operations in call order; an asynchronous operation holds the queue until it settles. */
class SerialOperationQueue {
  private tail: Promise<void> = Promise.resolve()
  private pending = 0

  run<T>(operation: () => T): Promise<T> {
    if (this.pending > 0) return this.enqueue(operation)
    try {
      return Promise.resolve(operation())
    } catch (error) {
      return Promise.reject(error)
    }
  }

  runAsync<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pending > 0) return this.enqueue(operation)
    this.pending++
    // Publish the barrier before the operation starts, so calls it makes synchronously wait behind it.
    const { promise: barrier, resolve: releaseBarrier } = Promise.withResolvers<void>()
    this.tail = barrier
    let started: Promise<T>
    try {
      started = operation()
    } catch (error) {
      started = Promise.reject(error)
    }
    return started.finally(() => {
      this.pending--
      releaseBarrier()
    })
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    this.pending++
    const settled = this.tail.then(operation).finally(() => {
      this.pending--
    })
    this.tail = settled.then(ignore, ignore)
    return settled
  }
}

type BunStatement = Statement<Record<string, unknown>, Array<SqliteValue>>

abstract class BunSqliteExecutor implements SqliteExecutor {
  protected readonly database: Database
  protected readonly statements: Map<string, BunStatement>

  constructor(database: Database, statements: Map<string, BunStatement>) {
    this.database = database
    this.statements = statements
  }

  exec(sql: string): Promise<void> {
    return this.runOperation(() => {
      this.database.run(sql)
    })
  }

  run(sql: string, ...params: Array<SqliteValue>): Promise<void> {
    return this.runOperation(() => {
      this.statement(sql).run(...params)
    })
  }

  get<T extends object>(sql: string, ...params: Array<SqliteValue>): Promise<T | undefined> {
    // bun:sqlite returns null for no row; the facade contract is undefined.
    return this.runOperation(() => (this.statement(sql).get(...params) ?? undefined) as T | undefined)
  }

  all<T extends object>(sql: string, ...params: Array<SqliteValue>): Promise<Array<T>> {
    return this.runOperation(() => this.statement(sql).all(...params) as Array<T>)
  }

  protected abstract runOperation<T>(operation: () => T): Promise<T>

  private statement(sql: string): BunStatement {
    let statement = this.statements.get(sql)
    if (statement === undefined) {
      statement = this.database.prepare<Record<string, unknown>, Array<SqliteValue>>(sql)
      this.statements.set(sql, statement)
    }
    return statement
  }
}

class BunSqliteTransaction extends BunSqliteExecutor {
  private readonly scope: TransactionScope

  constructor(database: Database, statements: Map<string, BunStatement>, scope: TransactionScope) {
    super(database, statements)
    this.scope = scope
  }

  protected async runOperation<T>(operation: () => T): Promise<T> {
    if (!this.scope.active) throw new Error("SQLite transaction handle is no longer active")
    return operation()
  }
}

/** `SqliteDatabase` facade backed by `bun:sqlite`. */
export class BunSqliteDatabase extends BunSqliteExecutor implements SqliteDatabase {
  private readonly access = new SerialOperationQueue()
  private closed = false

  constructor(database: Database) {
    super(database, new Map())
  }

  transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
    return this.access.runAsync(async () => {
      this.database.run("BEGIN IMMEDIATE")
      const scope = { active: true }
      try {
        const result = await callback(new BunSqliteTransaction(this.database, this.statements, scope))
        scope.active = false
        this.database.run("COMMIT")
        return result
      } catch (error) {
        scope.active = false
        try {
          this.database.run("ROLLBACK")
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "SQLite transaction failed and rollback failed")
        }
        throw error
      }
    })
  }

  close(): Promise<void> {
    return this.access.run(() => {
      if (this.closed) return
      this.closed = true
      for (const statement of this.statements.values()) statement.finalize()
      this.statements.clear()
      try {
        this.database.run("PRAGMA wal_checkpoint(TRUNCATE)")
      } finally {
        this.database.close()
      }
    })
  }

  protected runOperation<T>(operation: () => T): Promise<T> {
    return this.access.run(operation)
  }
}

const BUSY_TIMEOUT_MS = 5_000

/** Open a WAL-mode bun:sqlite database configured like pi-durable's Node backend. */
export const openBunSqliteDatabase = (path: string): BunSqliteDatabase => {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
  const database = new Database(path, { create: true, strict: false })
  try {
    database.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
    database.run("PRAGMA journal_mode = WAL")
    database.run("PRAGMA synchronous = NORMAL")
    return new BunSqliteDatabase(database)
  } catch (error) {
    database.close()
    throw error
  }
}

/** Open or create file-backed pi-durable storage on bun:sqlite. */
export const openBunSqliteStorage = (path: string): Promise<SqliteStorage> =>
  SqliteStorage.open(openBunSqliteDatabase(path))
