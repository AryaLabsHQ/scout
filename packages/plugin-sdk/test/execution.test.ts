import { describe, expect, it } from "vitest"
import { Effect, Stream } from "effect"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  executePluginAction,
  loadPluginPackage,
  openPluginStream,
  PluginExecutionError,
} from "../src/index.js"

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures")

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

describe("@scout/plugin-sdk execution", () => {
  it("executes a plugin action through the generic runtime", async () => {
    const plugin = await run(
      loadPluginPackage(path.join(fixturesDir, "valid-plugin")),
    )

    const result = await run(
      executePluginAction(
        plugin,
        {
          nodeId: "node-1",
          permissions: new Set(["node:read-files"]),
        },
        {
          pluginId: "fixture-valid",
          actionId: "refresh",
          target: {
            nodeId: "node-1",
            entity: {
              pluginId: "fixture-valid",
              kind: "thing",
              nodeId: "node-1",
              id: "fixture-1",
            },
          },
          input: {},
        },
      ),
    )

    expect(result.success).toBe(true)
    expect(result.output).toEqual({ refreshed: true })
  })

  it("rejects actions when required permissions are missing", async () => {
    const plugin = await run(
      loadPluginPackage(path.join(fixturesDir, "valid-plugin")),
    )

    await expect(
      run(
        executePluginAction(
          plugin,
          {
            nodeId: "node-1",
            permissions: new Set(),
          },
          {
            pluginId: "fixture-valid",
            actionId: "refresh",
            target: {
              nodeId: "node-1",
              entity: {
                pluginId: "fixture-valid",
                kind: "thing",
                nodeId: "node-1",
                id: "fixture-1",
              },
            },
            input: {},
          },
        ),
      ),
    ).rejects.toBeInstanceOf(PluginExecutionError)
  })

  it("opens plugin streams through the generic runtime", async () => {
    const plugin = await run(
      loadPluginPackage(path.join(fixturesDir, "valid-plugin")),
    )

    const stream = await run(
      openPluginStream(
        plugin,
        {
          nodeId: "node-1",
          permissions: new Set(["node:read-files"]),
        },
        {
          pluginId: "fixture-valid",
          streamId: "events",
          target: {
            nodeId: "node-1",
            entity: {
              pluginId: "fixture-valid",
              kind: "thing",
              nodeId: "node-1",
              id: "fixture-1",
            },
          },
          input: {},
        },
      ),
    )

    const chunks = await run(Stream.runCollect(stream))
    expect(chunks.length).toBe(1)
    const first = chunks[0]
    expect(first).toBeDefined()
    expect(first && "event" in first).toBe(true)
    if (first === undefined || !("event" in first)) {
      throw new Error("expected event chunk")
    }
    expect(first.event.eventId).toBe("thing.updated")
  })
})
