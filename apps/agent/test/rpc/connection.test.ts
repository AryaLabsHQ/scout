/**
 * Tests for apps/agent/src/rpc/connection.ts against a real WebSocket hub.
 *
 * The fake hub is a Bun HTTP server that upgrades `/ws/rpc/agent` and serves
 * `AgentHubRpcs` over the same duplex adapter the real hub uses. Tests stop
 * and restart it on the same port, or freeze its sessions, and assert that
 * the agent notices, reconnects, and registers again.
 */

import { describe, expect, it } from "vitest"
import { ConfigProvider, Effect, Exit, Layer, Scope } from "effect"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"
import * as NetAddress from "effect/net/NetAddress"
import * as Socket from "effect/socket/Socket"
import { BunHttpServer } from "@effect/platform-bun"
import { AgentHubRpcs, makeDuplexRpcProtocols } from "@scout/shared"
import type { AgentCapabilities } from "@scout/shared"
import type { PluginCapability, PluginCollectionResult } from "@scout/plugin-sdk"
import {
  HubClient,
  type HubConnectionTiming,
  makeHubConnectionLayer,
} from "../../src/rpc/connection.js"
import { CollectorRegistry } from "../../src/services/collector-registry.js"
import { AgentPluginHost } from "../../src/services/plugin-host.js"

// ── Fake hub ──────────────────────────────────────────────────────────────────

interface FakeHubState {
  /** Hostnames from every successful `agent.connect`, in order. */
  readonly connects: Array<string>
  /** Plugin collection reports received. */
  reports: number
  /**
   * Sessions opened before the current epoch stop reading, so their pings go
   * unanswered while the socket stays open. Bump it to freeze open sessions.
   */
  freezeEpoch: number
}

/** Pulls stop returning, without closing the socket, once the session is frozen. */
const freezable = (socket: Socket.Socket, state: FakeHubState): Socket.Socket => {
  const epoch = state.freezeEpoch
  return Socket.make({
    reader: Effect.map(socket.reader, (reader) => ({
      ...reader,
      pull: Effect.flatMap(reader.pull, (frames) =>
        state.freezeEpoch > epoch ? Effect.never : Effect.succeed(frames),
      ),
    })),
    writer: socket.writer,
  })
}

const handlers = (state: FakeHubState) =>
  AgentHubRpcs.toLayer({
    "agent.connect": (payload) =>
      Effect.sync(() => {
        state.connects.push(payload.hostname)
        return { systemId: payload.hostname }
      }),
    "agent.report": () => Effect.void,
    "agent.reportPluginCollection": () =>
      Effect.sync(() => {
        state.reports++
      }),
  })

const agentSocketApp = (state: FakeHubState) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const socket = yield* Effect.orDie(request.upgrade)
    yield* Effect.scoped(
      Effect.gen(function* () {
        const { serverProtocol, closed } = yield* makeDuplexRpcProtocols(
          freezable(socket, state),
        )
        yield* RpcServer.make(AgentHubRpcs).pipe(
          Effect.provide(handlers(state)),
          Effect.provide(serverProtocol),
          Effect.raceFirst(closed),
        )
      }),
    ).pipe(Effect.provide(RpcSerialization.layerNdjson))
    return HttpServerResponse.empty()
    // Raw server apps run uninterruptibly; the hub's HttpRouter routes do not,
    // which is what lets a shutdown close open agent sockets.
  }).pipe(Effect.interruptible)

/**
 * Start a hub on `port` (0 picks a free one). Closing the returned scope
 * shuts it down the way the hub process does on SIGTERM.
 */
const startHub = (state: FakeHubState, port: number) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const server = yield* BunHttpServer.make({
      hostname: "127.0.0.1",
      port,
      disablePreemptiveShutdown: true,
    }).pipe(Scope.provide(scope))
    yield* server.serve(agentSocketApp(state)).pipe(Scope.provide(scope))
    if (!NetAddress.isInetAddress(server.address)) {
      return yield* Effect.die(new Error("fake hub is not listening on TCP"))
    }
    return { scope, port: server.address.port }
  })

// ── Agent under test ──────────────────────────────────────────────────────────

const timing: HubConnectionTiming = {
  heartbeatInterval: "200 millis",
  handshakeTimeout: "2 seconds",
  retryBase: "50 millis",
  retryCap: "200 millis",
  teardownTimeout: "1 second",
}

const capabilities: AgentCapabilities = {
  system: true,
  network: false,
  process: false,
  temperature: false,
  gpu: false,
  smart: false,
}

const agentLayer = (port: number) =>
  makeHubConnectionLayer(timing).pipe(
    Layer.provide(
      Layer.succeed(CollectorRegistry)({
        discover: () => Effect.succeed(capabilities),
        collectAll: () => Effect.die("collectAll is not used by the connection"),
      }),
    ),
    Layer.provide(
      Layer.succeed(AgentPluginHost)({
        listCapabilities: () => Effect.succeed([] as ReadonlyArray<PluginCapability>),
        collectCollections: () => Effect.succeed([] as ReadonlyArray<PluginCollectionResult>),
        runAction: () => Effect.die("runAction is not used by the connection"),
        openLogStream: () => Effect.die("openLogStream is not used by the connection"),
      }),
    ),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          SCOUT_HUB_URL: `http://127.0.0.1:${port}`,
          SCOUT_TOKEN: "test-token",
          SCOUT_HOSTNAME: "test-agent",
        }),
      ),
    ),
  )

/** Poll until `predicate` holds; fails the test after `timeoutMs`. */
const waitUntil = (label: string, predicate: () => boolean, timeoutMs: number) =>
  Effect.gen(function* () {
    const started = Date.now()
    while (!predicate()) {
      if (Date.now() - started > timeoutMs) {
        return yield* Effect.die(new Error(`timed out after ${timeoutMs}ms waiting for ${label}`))
      }
      yield* Effect.sleep("20 millis")
    }
    return Date.now() - started
  })

const sendReport = Effect.gen(function* () {
  const hub = yield* HubClient
  yield* hub["agent.reportPluginCollection"]({
    systemId: "test-agent",
    collection: {},
  }).pipe(Effect.timeout("2 seconds"))
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("HubConnectionLayer", () => {
  it("reconnects and registers again after the hub restarts on the same port", async () => {
    const state: FakeHubState = { connects: [], reports: 0, freezeEpoch: 0 }

    const program = Effect.gen(function* () {
      const first = yield* startHub(state, 0)
      const port = first.port

      const agentScope = yield* Scope.make()
      yield* Layer.build(agentLayer(port)).pipe(Scope.provide(agentScope))

      yield* waitUntil("first registration", () => state.connects.length === 1, 3_000)

      // Shut the hub down and leave it down long enough for several failed
      // dials, so the agent is backing off when the hub returns.
      yield* Scope.close(first.scope, Exit.void)
      yield* Effect.sleep("1500 millis")

      const second = yield* startHub(state, port)
      const reconnectMs = yield* waitUntil(
        "registration with the restarted hub",
        () => state.connects.length === 2,
        3_000,
      )

      yield* Scope.close(agentScope, Exit.void)
      yield* Scope.close(second.scope, Exit.void)
      return reconnectMs
    })

    const reconnectMs = await Effect.runPromise(Effect.scoped(program))
    expect(state.connects).toEqual(["test-agent", "test-agent"])
    // Bounded by the 200ms retry cap plus jitter, not the old 30s ceiling.
    expect(reconnectMs).toBeLessThan(1_000)
  }, 15_000)

  it("drops a hub that stops answering heartbeats and reconnects", async () => {
    const state: FakeHubState = { connects: [], reports: 0, freezeEpoch: 0 }

    const program = Effect.gen(function* () {
      const hub = yield* startHub(state, 0)
      const agentScope = yield* Scope.make()
      const context = yield* Layer.build(agentLayer(hub.port)).pipe(Scope.provide(agentScope))

      yield* waitUntil("first registration", () => state.connects.length === 1, 3_000)
      yield* sendReport.pipe(Effect.provide(context))

      // The socket stays open, but the hub stops reading: only the
      // heartbeat can notice.
      state.freezeEpoch++

      const detectMs = yield* waitUntil(
        "registration after the heartbeat timeout",
        () => state.connects.length === 2,
        3_000,
      )

      // The new session carries traffic again.
      yield* sendReport.pipe(Effect.provide(context))

      yield* Scope.close(agentScope, Exit.void)
      yield* Scope.close(hub.scope, Exit.void)
      return detectMs
    })

    const detectMs = await Effect.runPromise(Effect.scoped(program))
    expect(state.connects).toHaveLength(2)
    expect(state.reports).toBe(2)
    // Two heartbeat intervals (400ms) plus one retry at most.
    expect(detectMs).toBeLessThan(1_500)
  }, 15_000)
})
