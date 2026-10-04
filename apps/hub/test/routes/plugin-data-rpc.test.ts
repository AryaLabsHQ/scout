/**
 * The read-only plugin data RPCs over a real Bun server: entities, metric
 * points, and events that an agent reported for one plugin on one system.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Redacted } from "effect"
import { BunHttpServer } from "@effect/platform-bun"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServer from "effect/http/HttpServer"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"
import * as Socket from "effect/socket/Socket"
import { ClientHubRpcs } from "@scout/shared"
import { BrowserAuth } from "../../src/auth/browser-auth.js"
import { HttpAuthGate } from "../../src/auth/http-gate.js"
import { HubConfig } from "../../src/config.js"
import { ClientAuthMiddlewareLive } from "../../src/rpc/auth.js"
import { ClientHandlersLive, clampHours } from "../../src/rpc/client-handlers.js"
import { AlertEngine } from "../../src/services/alert-engine.js"
import { MetricsBroadcast } from "../../src/services/metrics-broadcast.js"
import { MetricsIngestion } from "../../src/services/metrics-ingestion.js"
import { operatorLayer } from "../helpers/operator.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"

const directory = mkdtempSync(join(tmpdir(), "scout-plugin-data-rpc-"))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

const TestConfigLayer = Layer.succeed(HubConfig)({
  host: "127.0.0.1",
  port: 0,
  agentToken: Redacted.make("agent-token-for-tests"),
  browserAuth: { _tag: "Disabled" },
})

const serveHub = (storagePath: string) => {
  const services = Layer.mergeAll(
    operatorLayer(storagePath),
    MetricsBroadcast.layer,
    AlertEngine.layer.pipe(Layer.provide(Layer.merge(TestDatabaseLayer, MetricsBroadcast.layer))),
  )
  const rpc = RpcServer.layer(ClientHubRpcs, { disableFatalDefects: true }).pipe(
    Layer.provide(ClientHandlersLive),
    Layer.provide(ClientAuthMiddlewareLive),
    Layer.provide(RpcServer.layerProtocolWebsocket({ path: "/ws/rpc" })),
    Layer.provide(RpcSerialization.layerNdjson),
  )
  return Layer.mergeAll(rpc, HttpAuthGate).pipe(
    HttpRouter.serve,
    Layer.provide(Layer.succeed(BrowserAuth)(BrowserAuth.disabled)),
    Layer.provide(TestConfigLayer),
    Layer.provideMerge(BunHttpServer.layerTest),
    Layer.provideMerge(services),
  )
}

const connectRpc = Effect.gen(function* () {
  const url = yield* HttpServer.addressFormattedWith((address) =>
    Effect.succeed(`${address.replace(/^http/, "ws")}/ws/rpc`),
  )
  const socket = yield* Socket.makeWebSocket(url).pipe(
    Effect.provideService(Socket.WebSocketConstructor, (target) => new globalThis.WebSocket(target)),
  )
  const protocol = yield* Layer.build(
    RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Layer.succeed(Socket.Socket)(socket)),
      Layer.provide(RpcSerialization.layerNdjson),
    ),
  )
  return yield* RpcClient.make(ClientHubRpcs).pipe(Effect.provide(protocol))
})

const unit = (id: string, status: string, ts = Date.now()) => ({
  ref: { pluginId: "systemd", kind: "systemd.unit", nodeId: "node-a", id },
  ts,
  displayName: id,
  status,
  labels: { subState: status === "active" ? "running" : "dead" },
})

describe("plugin data RPCs", () => {
  it.live("returns the entities, metric points, and events an agent reported", () =>
    Effect.gen(function* () {
      const ingestion = yield* MetricsIngestion
      const now = Date.now()
      yield* ingestion.ingestPluginCollection("node-a", {
        entities: [unit("caddy.service", "active"), unit("restic-backup.service", "inactive")],
        metrics: [
          {
            pluginId: "systemd",
            metricId: "unit.memory.bytes",
            ts: now,
            entity: unit("caddy.service", "active").ref,
            value: 54_988_800,
            unit: "bytes",
          },
        ],
        events: [
          {
            pluginId: "systemd",
            eventId: "unit.failed",
            ts: now,
            entity: unit("restic-backup.service", "inactive").ref,
            severity: "warning",
            message: "restic-backup.service failed",
          },
        ],
      })
      yield* ingestion.ingestPluginCollection("node-b", { entities: [unit("other.service", "active")] })

      const client = yield* connectRpc
      const entities = yield* client["plugins.entities"]({ systemId: "node-a", pluginId: "systemd" })
      expect(entities.map((entity) => entity.ref.id).sort()).toEqual(["caddy.service", "restic-backup.service"])

      const byKind = yield* client["plugins.entities"]({ systemId: "node-a", pluginId: "systemd", kind: "k8s.pod" })
      expect(byKind).toEqual([])

      const metrics = yield* client["plugins.metrics"]({
        systemId: "node-a",
        pluginId: "systemd",
        hours: 1,
        metricId: "unit.memory.bytes",
      })
      expect(metrics.map((point) => point.value)).toEqual([54_988_800])

      const events = yield* client["plugins.events"]({ systemId: "node-a", pluginId: "systemd", hours: 24 })
      expect(events.map((event) => event.eventId)).toEqual(["unit.failed"])

      // A later collection without restic-backup means the unit is gone from the node.
      yield* ingestion.ingestPluginCollection("node-a", { entities: [unit("caddy.service", "active", now + 15_000)] })
      const current = yield* client["plugins.entities"]({ systemId: "node-a", pluginId: "systemd" })
      expect(current.map((entity) => entity.ref.id)).toEqual(["caddy.service"])
    }).pipe(Effect.scoped, Effect.provide(serveHub(join(directory, "operator.sqlite")))),
    20_000,
  )

  it("clamps plugin look-back windows to 1..720 hours", () => {
    expect(clampHours(0)).toBe(1)
    expect(clampHours(24)).toBe(24)
    expect(clampHours(10_000)).toBe(720)
    expect(clampHours(Number.NaN)).toBe(1)
  })
})
