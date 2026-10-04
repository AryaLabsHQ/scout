/**
 * The unit log stream runs a real `journalctl -f` child. These tests put a
 * fake `journalctl` first on PATH that prints its pid, a few lines, and then
 * stays quiet, the way a following journal does for an idle unit.
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { openPluginStream, type StreamChunk } from "@scout/plugin-sdk"
import { SYSTEMD_PLUGIN_ID, SYSTEMD_STREAM_IDS, SYSTEMD_UNIT_KIND } from "../src/contracts.js"
import { manifest } from "../src/manifest.js"
import { createSystemdAgentPlugin } from "../src/systemd.js"

let binDir = ""
let originalPath: string | undefined

beforeAll(() => {
  binDir = mkdtempSync(join(tmpdir(), "scout-fake-journalctl-"))
  const script = join(binDir, "journalctl")
  writeFileSync(script, '#!/bin/sh\necho "pid $$"\necho "args $*"\nexec sleep 600\n')
  chmodSync(script, 0o755)
  originalPath = process.env["PATH"]
  process.env["PATH"] = `${binDir}:${originalPath ?? ""}`
})

afterAll(() => {
  process.env["PATH"] = originalPath
  rmSync(binDir, { recursive: true, force: true })
})

const openUnitLogs = openPluginStream(
  { manifest, agent: createSystemdAgentPlugin() },
  {
    nodeId: "node-1",
    permissions: new Set(["node:systemd", "node:stream-logs", "node:spawn-process"]),
  },
  {
    pluginId: SYSTEMD_PLUGIN_ID,
    streamId: SYSTEMD_STREAM_IDS.unitLogs,
    target: {
      nodeId: "node-1",
      entity: {
        pluginId: SYSTEMD_PLUGIN_ID,
        kind: SYSTEMD_UNIT_KIND,
        nodeId: "node-1",
        id: "cron.service",
      },
    },
    input: { tail: 5 },
  },
)

const pidOf = (chunk: StreamChunk): number => {
  if (!("lines" in chunk)) throw new Error(`not a log chunk: ${JSON.stringify(chunk)}`)
  const line = chunk.lines.find((value) => value.startsWith("pid "))
  if (line === undefined) throw new Error(`no pid line in ${JSON.stringify(chunk.lines)}`)
  return Number(line.slice("pid ".length))
}

/** `kill(pid, 0)` still succeeds for an unreaped zombie, so this proves reaping too. */
const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Interrupts the test effect after `ms`, so a failing run still closes the
 * stream scope instead of leaving its child behind.
 */
const runWithDeadline = <A, E>(effect: Effect.Effect<A, E>, ms = 5_000): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.timeout(ms)))

describe("systemd unit log stream", () => {
  it("kills and reaps journalctl when the consumer stops after the first batch", async () => {
    const first = await runWithDeadline(openUnitLogs.pipe(Effect.flatMap((stream) => Stream.runHead(stream))))

    expect(first._tag).toBe("Some")
    if (first._tag !== "Some") return
    expect(first.value).toMatchObject({
      lines: expect.arrayContaining(["args -f -u cron.service -n 5 --output=short-iso"]),
    })
    expect(isRunning(pidOf(first.value))).toBe(false)
  })

  it("kills and reaps journalctl when the stream is interrupted while idle", async () => {
    const pid = await runWithDeadline(
      Effect.gen(function* () {
        const stream = yield* openUnitLogs
        const first = yield* Deferred.make<StreamChunk>()
        const fiber = yield* Stream.runForEach(stream, (chunk) => Deferred.succeed(first, chunk)).pipe(
          Effect.forkChild,
        )

        const chunk = yield* Deferred.await(first)
        // The child is now blocked on a quiet journal, like an idle unit.
        yield* Effect.sleep("100 millis")
        yield* Fiber.interrupt(fiber)
        return pidOf(chunk)
      }),
    )

    expect(isRunning(pid)).toBe(false)
  })
})
