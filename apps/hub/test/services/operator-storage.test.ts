import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { registerStorageConformance } from "@earendil-works/pi-durable/testing"
import { describe, expect, it } from "vitest"
import { openBunSqliteDatabase, openBunSqliteStorage } from "../../src/services/operator-storage.js"

registerStorageConformance({ describe, expect, it }, "bun:sqlite pi-durable storage", async (use) => {
  const directory = mkdtempSync(join(tmpdir(), "scout-operator-storage-"))
  const storage = await openBunSqliteStorage(join(directory, "operator.sqlite"))
  try {
    await use(storage)
  } finally {
    await storage.close(BACKGROUND_CONTEXT)
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("BunSqliteDatabase facade", () => {
  it("queues other operations behind a running transaction and rolls back on failure", async () => {
    const database = openBunSqliteDatabase(":memory:")
    await database.exec("CREATE TABLE example (value TEXT)")
    const order: Array<string> = []
    const failing = database.transaction(async (tx) => {
      await tx.run("INSERT INTO example (value) VALUES (?)", "rolled back")
      order.push("tx")
      await new Promise((resolve) => setTimeout(resolve, 10))
      throw new Error("boom")
    })
    const outside = database.get<{ count: number }>("SELECT count(*) AS count FROM example").then((row) => {
      order.push("outside")
      return row
    })
    await expect(failing).rejects.toThrow("boom")
    expect(await outside).toEqual({ count: 0 })
    expect(order).toEqual(["tx", "outside"])
    expect(await database.get("SELECT value FROM example")).toBeUndefined()
    await database.close()
  })
})
