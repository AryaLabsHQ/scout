/**
 * `agent.connect` over the real `/ws/rpc/agent` route and handler: an agent
 * connects only as the hostname its token belongs to, and a rejected attempt
 * leaves `AgentRegistry` untouched.
 */

import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Layer, PubSub, Redacted, Scope, Stream } from "effect"
import { BunHttpServer } from "@effect/platform-bun"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServer from "effect/http/HttpServer"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcServer from "effect/rpc/RpcServer"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Socket from "effect/socket/Socket"
import {
  AgentConnectError,
  AgentReportError,
  AgentHubRpcs,
  HubAgentRpcs,
  makeDuplexRpcProtocols,
} from "@scout/shared"
import { BrowserAuth } from "../../src/auth/browser-auth.js"
import { HttpAuthGate } from "../../src/auth/http-gate.js"
import { HubConfig } from "../../src/config.js"
import { AgentRegistry } from "../../src/rpc/agent-bridge.js"
import { AgentRpcRoute } from "../../src/rpc/server.js"
import { AlertEngine } from "../../src/services/alert-engine.js"
import { MetricsBroadcast } from "../../src/services/metrics-broadcast.js"
import { MetricsIngestion } from "../../src/services/metrics-ingestion.js"
import { Database } from "../../src/services/database.js"
import * as tables from "../../drizzle/schema.js"
import { makeCoreMetricsPayload } from "../helpers/fixtures.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"

const NODE_1_TOKEN = "node-1-token-for-tests"
const NODE_2_TOKEN = "node-2-token-for-tests"

const TestConfigLayer = Layer.succeed(HubConfig)({
  host: "127.0.0.1",
  port: 0,
  agentTokens: new Map([
    ["node-1", Redacted.make(NODE_1_TOKEN)],
    ["node-2", Redacted.make(NODE_2_TOKEN)],
  ]),
  browserAuth: { _tag: "Disabled" },
})

const TestAppLayer = Layer.mergeAll(
  MetricsBroadcast.layer,
  MetricsIngestion.layer,
  AgentRegistry.layer,
  AlertEngine.layer.pipe(Layer.provide(MetricsBroadcast.layer)),
).pipe(Layer.provideMerge(TestDatabaseLayer))

const ServeHub = Layer.mergeAll(AgentRpcRoute, HttpAuthGate).pipe(
  HttpRouter.serve,
  Layer.provide(Layer.succeed(BrowserAuth)(BrowserAuth.disabled)),
  Layer.provide(TestConfigLayer),
  Layer.provideMerge(BunHttpServer.layerTest),
  Layer.provideMerge(TestAppLayer),
)

/**
 * Opens an agent socket with `token` (which also passes the upgrade gate) and
 * serves a management RPC. Registration is separate. Runs in the caller's scope.
 */
const openAgent = (token: string, onClose: (sessionId: string) => void = () => {}) =>
  Effect.gen(function* () {
    const url = yield* HttpServer.addressFormattedWith((address) =>
      Effect.succeed(`${address.replace(/^http/, "ws")}/ws/rpc/agent`),
    )
    const socket = yield* Socket.makeWebSocket(url).pipe(
      Effect.provideService(
        Socket.WebSocketConstructor,
        (target) => new globalThis.WebSocket(target, { headers: { authorization: `Bearer ${token}` } }),
      ),
    )
    const { clientProtocol, serverProtocol } = yield* makeDuplexRpcProtocols(socket).pipe(
      Effect.provide(RpcSerialization.layerNdjson),
    )
    yield* RpcServer.make(HubAgentRpcs).pipe(
      Effect.provide(
        HubAgentRpcs.toLayer({
          "terminal.close": ({ sessionId }) => Effect.sync(() => onClose(sessionId)),
          "terminal.open": () => Stream.die("terminal.open is not scripted"),
          "terminal.exec": () => Stream.die("terminal.exec is not scripted"),
          "terminal.input": () => Effect.die("terminal.input is not scripted"),
          "terminal.resize": () => Effect.die("terminal.resize is not scripted"),
          "plugins.logs": () => Stream.die("plugins.logs is not scripted"),
          "plugins.runAction": () => Effect.die("plugins.runAction is not scripted"),
        }),
      ),
      Effect.provide(serverProtocol),
      Effect.forkScoped,
    )
    const client = yield* RpcClient.make(AgentHubRpcs).pipe(Effect.provide(clientProtocol))
    return client
  })

const registration = (hostname: string, token: string) => ({
  token,
  hostname,
  version: "0.0.1",
  platform: "linux",
  capabilities: {
    system: true,
    network: false,
    process: false,
    temperature: false,
    gpu: false,
    smart: false,
  },
})

const connectAs = (hostname: string, token: string) =>
  Effect.gen(function* () {
    const client = yield* openAgent(token)
    return yield* client["agent.connect"](registration(hostname, token)).pipe(
      Effect.timeout("5 seconds"),
      Effect.exit,
    )
  })

const connectedHostnames = AgentRegistry.use((registry) => registry.listConnected()).pipe(
  Effect.map((agents) => agents.map((agent) => agent.info.hostname).sort()),
)

const expectInvalidToken = (exit: Exit.Exit<unknown, unknown>) => {
  expect(Exit.isFailure(exit)).toBe(true)
  const error = Exit.isFailure(exit)
    ? exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error
    : null
  expect(error).toBeInstanceOf(AgentConnectError)
  expect((error as AgentConnectError).reason).toBe("invalid-token")
}

describe("agent.connect token binding", () => {
  it.live("accepts each host's own token and registers it", () =>
    Effect.gen(function* () {
      expect(yield* connectAs("node-1", NODE_1_TOKEN)).toEqual(Exit.succeed({ systemId: "node-1" }))
      expect(yield* connectedHostnames).toEqual(["node-1"])
      expect(yield* connectAs("node-2", NODE_2_TOKEN)).toEqual(Exit.succeed({ systemId: "node-2" }))
      expect(yield* connectedHostnames).toEqual(["node-1", "node-2"])
    }).pipe(Effect.scoped, Effect.provide(ServeHub)),
  )

  it.live("rejects another host's token without touching the registry", () =>
    Effect.gen(function* () {
      expectInvalidToken(yield* connectAs("node-1", NODE_2_TOKEN))
      expect(yield* connectedHostnames).toEqual([])

      // A rejected impersonation does not displace the real node-1.
      yield* connectAs("node-1", NODE_1_TOKEN)
      const before = yield* AgentRegistry.use((registry) => registry.getConnected("node-1"))
      expectInvalidToken(yield* connectAs("node-1", NODE_2_TOKEN))
      expect(yield* AgentRegistry.use((registry) => registry.getConnected("node-1"))).toEqual(before)
      expect(yield* connectedHostnames).toEqual(["node-1"])
    }).pipe(Effect.scoped, Effect.provide(ServeHub)),
  )

  it.live("rejects a hostname with no configured token", () =>
    Effect.gen(function* () {
      expectInvalidToken(yield* connectAs("node-3", NODE_1_TOKEN))
      expect(yield* connectedHostnames).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(ServeHub)),
  )
})

const expectReportRejection = (exit: Exit.Exit<unknown, unknown>, reason: string) => {
  expect(Exit.isFailure(exit)).toBe(true)
  const error = Exit.isFailure(exit)
    ? exit.cause.reasons.find((cause) => cause._tag === "Fail")?.error
    : undefined
  expect(error).toBeInstanceOf(AgentReportError)
  expect(error).toMatchObject({ _tag: "AgentReportError", reason })
}

describe("agent report connection attribution", () => {
  it.live("requires registration and atomically rejects foreign collection references", () =>
    Effect.gen(function* () {
      const client = yield* openAgent(NODE_1_TOKEN)
      expectReportRejection(
        yield* client["agent.report"](makeCoreMetricsPayload("node-1")).pipe(Effect.exit),
        "not-connected",
      )
      expectReportRejection(
        yield* client["agent.reportPluginCollection"]({ systemId: "node-1", collection: {} }).pipe(
          Effect.exit,
        ),
        "not-connected",
      )
      yield* client["agent.connect"](registration("node-1", NODE_1_TOKEN))
      yield* connectAs("node-2", NODE_2_TOKEN)
      const db = yield* Database
      const broadcast = yield* MetricsBroadcast
      const subscription = yield* broadcast.subscribe()
      db.insert(tables.alertRules)
        .values({
          id: "attribution-core",
          metric: "cpu.usage",
          operator: ">",
          threshold: 0,
          consecutiveCount: 2,
          severity: "critical",
          enabled: true,
          createdAt: new Date(),
        })
        .run()
      db.insert(tables.alertRules)
        .values({
          id: "attribution-plugin",
          metric: "docker.cpu",
          operator: ">",
          threshold: 0,
          consecutiveCount: 2,
          severity: "critical",
          enabled: true,
          createdAt: new Date(),
        })
        .run()
      expectReportRejection(
        yield* client["agent.reportPluginCollection"]({ systemId: "node-2", collection: {} }).pipe(
          Effect.exit,
        ),
        "system-mismatch",
      )
      expectReportRejection(
        yield* client["agent.report"](makeCoreMetricsPayload("node-2")).pipe(Effect.exit),
        "system-mismatch",
      )
      expectReportRejection(
        yield* client["agent.report"](makeCoreMetricsPayload("node-2")).pipe(Effect.exit),
        "system-mismatch",
      )
      const foreign = { pluginId: "docker", kind: "container", nodeId: "node-2", id: "foreign" }
      for (const collection of [
        { entities: [{ ref: foreign, ts: Date.now() }] },
        { metrics: [{ pluginId: "docker", metricId: "cpu", ts: Date.now(), entity: foreign, value: 99 }] },
        {
          events: [
            {
              pluginId: "docker",
              eventId: "test",
              ts: Date.now(),
              entity: foreign,
              severity: "info" as const,
            },
          ],
        },
        {
          entities: [
            {
              ref: { ...foreign, nodeId: "node-1" },
              ts: Date.now(),
              relationships: [{ type: "uses", target: foreign }],
            },
          ],
        },
      ]) {
        expectReportRejection(
          yield* client["agent.reportPluginCollection"]({
            systemId: "node-1",
            collection: {
              ...collection,
              // Valid records preceding the foreign record must not leak writes
              // or increment the node-level alert counter.
              metrics: [
                { pluginId: "docker", metricId: "cpu", ts: Date.now(), value: 99 },
                ...(collection.metrics ?? []),
              ],
            },
          }).pipe(Effect.exit),
          "node-mismatch",
        )
      }
      expect(
        Exit.isFailure(yield* PubSub.take(subscription).pipe(Effect.timeout("200 millis"), Effect.exit)),
      ).toBe(true)
      expect(db.select().from(tables.systemMetrics).all()).toEqual([])
      expect(db.select().from(tables.pluginEntities).all()).toEqual([])
      expect(db.select().from(tables.pluginMetricPoints).all()).toEqual([])
      expect(db.select().from(tables.pluginEvents).all()).toEqual([])
      expect(db.select().from(tables.alerts).all()).toEqual([])
      const acceptedCore = makeCoreMetricsPayload("node-1")
      yield* client["agent.report"](acceptedCore)
      expect(yield* PubSub.take(subscription).pipe(Effect.timeout("2 seconds"))).toEqual({
        event: "metrics.data",
        data: [acceptedCore.sample],
      })
      expect(
        db
          .select()
          .from(tables.systemMetrics)
          .all()
          .map((row) => row.systemId),
      ).toEqual(["node-1"])
      const own = { ...foreign, nodeId: "node-1", id: "own" }
      const valid = {
        entities: [{ ref: own, ts: Date.now(), relationships: [{ type: "uses", target: own }] }],
        metrics: [
          { pluginId: "docker", metricId: "cpu", ts: Date.now(), value: 99 },
          { pluginId: "docker", metricId: "cpu", ts: Date.now(), value: 50, entity: own },
        ],
        events: [
          { pluginId: "docker", eventId: "test", ts: Date.now(), entity: own, severity: "info" as const },
        ],
      }
      yield* client["agent.reportPluginCollection"]({ systemId: "node-1", collection: valid })
      expect(db.select().from(tables.alerts).all()).toEqual([])
      expect(db.select().from(tables.pluginEntities).all()).toHaveLength(1)
      expect(db.select().from(tables.pluginMetricPoints).all()).toHaveLength(2)
      expect(db.select().from(tables.pluginEvents).all()).toHaveLength(1)
      yield* client["agent.report"](makeCoreMetricsPayload("node-1"))
      yield* client["agent.reportPluginCollection"]({ systemId: "node-1", collection: valid })
      expect(
        db
          .select()
          .from(tables.alerts)
          .all()
          .map((row) => row.ruleId)
          .sort(),
      ).toEqual(["attribution-core", "attribution-plugin"])
    }).pipe(Effect.scoped, Effect.provide(ServeHub)),
  )
})

describe("agent connection lifecycle and routing", () => {
  for (const replaceBeforeClose of [false, true]) {
    it.live(
      `cleans failed registration retries and preserves ${replaceBeforeClose ? "the replacement" : "another node"} on close`,
      () =>
        Effect.gen(function* () {
          const db = yield* Database
          const registry = yield* AgentRegistry
          const calls: string[] = []
          const other = yield* openAgent(NODE_2_TOKEN, (id) => calls.push(`two:${id}`))
          yield* other["agent.connect"](registration("node-2", NODE_2_TOKEN))
          const failedScope = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(failedScope, Exit.void))
          const failed = yield* openAgent(NODE_1_TOKEN).pipe(Effect.provideService(Scope.Scope, failedScope))
          db.$client.exec(`
            CREATE TRIGGER reject_registration BEFORE INSERT ON systems
            WHEN NEW.id = 'node-1'
            BEGIN SELECT RAISE(ABORT, 'injected registration failure'); END;
          `)
          for (let attempt = 0; attempt < 2; attempt++) {
            const result = yield* failed["agent.connect"](registration("node-1", NODE_1_TOKEN)).pipe(
              Effect.exit,
            )
            expect(Exit.isFailure(result)).toBe(true)
            expectReportRejection(
              yield* failed["agent.report"](makeCoreMetricsPayload("node-1")).pipe(Effect.exit),
              "not-connected",
            )
            expectReportRejection(
              yield* failed["agent.reportPluginCollection"]({ systemId: "node-1", collection: {} }).pipe(
                Effect.exit,
              ),
              "not-connected",
            )
            expect(yield* registry.getClient("node-1")).toBeNull()
          }
          expect(
            db
              .select()
              .from(tables.systems)
              .all()
              .map((row) => row.id),
          ).toEqual(["node-2"])
          expect(db.select().from(tables.systemMetrics).all()).toEqual([])
          db.$client.exec("DROP TRIGGER reject_registration")
          if (replaceBeforeClose) {
            const replacement = yield* openAgent(NODE_1_TOKEN, (id) => calls.push(`new:${id}`))
            yield* replacement["agent.connect"](registration("node-1", NODE_1_TOKEN))
          }
          yield* Scope.close(failedScope, Exit.void)
          yield* other["agent.report"](makeCoreMetricsPayload("node-2"))
          expect(yield* connectedHostnames).toEqual(replaceBeforeClose ? ["node-1", "node-2"] : ["node-2"])
          for (const host of replaceBeforeClose ? ["node-1", "node-2"] : ["node-2"]) {
            const client = yield* registry.getClient(host)
            expect(client).not.toBeNull()
            const sessionId = "after-failed-close"
            yield* client!["terminal.close"]({ sessionId }).pipe(Effect.timeout("2 seconds"))
          }
          expect(calls).toEqual(
            replaceBeforeClose
              ? ["new:after-failed-close", "two:after-failed-close"]
              : ["two:after-failed-close"],
          )
        }).pipe(Effect.scoped, Effect.provide(ServeHub)),
    )
  }

  it.live(
    "keeps independent management clients, immutable identity and idempotent repeat connect across reconnect",
    () =>
      Effect.gen(function* () {
        const calls: string[] = []
        const oldScope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(oldScope, Exit.void))
        const first = yield* openAgent(NODE_1_TOKEN, (id) => calls.push(`old:${id}`)).pipe(
          Effect.provideService(Scope.Scope, oldScope),
        )
        const second = yield* openAgent(NODE_2_TOKEN, (id) => calls.push(`two:${id}`))
        yield* Effect.all(
          [
            first["agent.connect"](registration("node-1", NODE_1_TOKEN)),
            second["agent.connect"](registration("node-2", NODE_2_TOKEN)),
          ],
          { concurrency: "unbounded" },
        )
        const registry = yield* AgentRegistry
        const before = yield* registry.getConnected("node-1")
        const originalClient = yield* registry.getClient("node-1")
        expect(yield* first["agent.connect"](registration("node-1", NODE_1_TOKEN))).toEqual({
          systemId: "node-1",
        })
        expect(yield* registry.getConnected("node-1")).toEqual(before)
        expect(yield* registry.getClient("node-1")).toBe(originalClient)
        const switchResult = yield* first["agent.connect"](registration("node-2", NODE_2_TOKEN)).pipe(
          Effect.exit,
        )
        expect(
          Exit.isFailure(switchResult)
            ? switchResult.cause.reasons.find((reason) => reason._tag === "Fail")?.error
            : undefined,
        ).toMatchObject({ _tag: "AgentConnectError", reason: "already-connected" })
        const routeClose = (host: string, id: string) =>
          Effect.gen(function* () {
            const client = yield* registry.getClient(host)
            expect(client).not.toBeNull()
            yield* client!["terminal.close"]({ sessionId: id }).pipe(Effect.timeout("2 seconds"))
          })
        yield* routeClose("node-1", "before")
        yield* routeClose("node-2", "before")
        const replacement = yield* openAgent(NODE_1_TOKEN, (id) => calls.push(`new:${id}`))
        expectReportRejection(
          yield* replacement["agent.report"](makeCoreMetricsPayload("node-1")).pipe(Effect.exit),
          "not-connected",
        )
        yield* replacement["agent.connect"](registration("node-1", NODE_1_TOKEN))
        yield* first["agent.connect"](registration("node-1", NODE_1_TOKEN))
        yield* routeClose("node-1", "replacement")
        yield* Scope.close(oldScope, Exit.void)
        yield* routeClose("node-1", "after-old-close")
        yield* routeClose("node-2", "after-old-close")
        yield* replacement["agent.report"](makeCoreMetricsPayload("node-1"))
        yield* second["agent.report"](makeCoreMetricsPayload("node-2"))
        expect(yield* connectedHostnames).toEqual(["node-1", "node-2"])
        expect(calls).toEqual([
          "old:before",
          "two:before",
          "new:replacement",
          "new:after-old-close",
          "two:after-old-close",
        ])
        const db = yield* Database
        expect(
          db
            .select()
            .from(tables.systemMetrics)
            .all()
            .map((row) => row.systemId)
            .sort(),
        ).toEqual(["node-1", "node-2"])
      }).pipe(Effect.scoped, Effect.provide(ServeHub)),
  )
})
