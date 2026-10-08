/**
 * `agent.connect` over the real `/ws/rpc/agent` route and handler: an agent
 * connects only as the hostname its token belongs to, and a rejected attempt
 * leaves `AgentRegistry` untouched.
 */

import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Layer, Redacted } from "effect"
import { BunHttpServer } from "@effect/platform-bun"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServer from "effect/http/HttpServer"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Socket from "effect/socket/Socket"
import { AgentConnectError, AgentHubRpcs, makeDuplexRpcProtocols } from "@scout/shared"
import { BrowserAuth } from "../../src/auth/browser-auth.js"
import { HttpAuthGate } from "../../src/auth/http-gate.js"
import { HubConfig } from "../../src/config.js"
import { AgentRegistry } from "../../src/rpc/agent-bridge.js"
import { AgentRpcRoute } from "../../src/rpc/server.js"
import { AlertEngine } from "../../src/services/alert-engine.js"
import { MetricsBroadcast } from "../../src/services/metrics-broadcast.js"
import { MetricsIngestion } from "../../src/services/metrics-ingestion.js"
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
 * calls `agent.connect` claiming `hostname`. Runs in the caller's scope.
 */
const connectAs = (hostname: string, token: string) =>
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
    const { clientProtocol } = yield* makeDuplexRpcProtocols(socket).pipe(
      Effect.provide(RpcSerialization.layerNdjson),
    )
    const client = yield* RpcClient.make(AgentHubRpcs).pipe(Effect.provide(clientProtocol))
    return yield* client["agent.connect"]({
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
    }).pipe(Effect.timeout("5 seconds"), Effect.exit)
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
