/**
 * HttpAuthGate + ClientAuthMiddleware over a real Bun server: `/api/*` and the
 * `/ws/rpc` upgrade reject unauthenticated requests and accept a valid
 * Cloudflare Access JWT, the agent path requires the agent token, and the
 * verified identity reaches RPC handlers.
 */

import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Layer, Redacted, Stream } from "effect"
import { BunHttpServer } from "@effect/platform-bun"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServer from "effect/http/HttpServer"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"
import * as Socket from "effect/socket/Socket"
import { ClientHubRpcs, CurrentIdentity, type System } from "@scout/shared"
import { makeAccessJwtVerifier, makeAccessKeyStore } from "../../src/auth/access-jwt.js"
import { BrowserAuth } from "../../src/auth/browser-auth.js"
import { HttpAuthGate } from "../../src/auth/http-gate.js"
import { HubConfig } from "../../src/config.js"
import { ClientAuthMiddlewareLive } from "../../src/rpc/auth.js"
import { AgentRegistry } from "../../src/rpc/agent-bridge.js"
import { AppRoutes } from "../../src/routes.js"
import { AlertEngine } from "../../src/services/alert-engine.js"
import { MetricsBroadcast } from "../../src/services/metrics-broadcast.js"
import { MetricsIngestion } from "../../src/services/metrics-ingestion.js"
import { PluginRegistry } from "../../src/services/plugin-registry.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"
import {
  TEST_AUD,
  TEST_EMAIL,
  TEST_ISSUER,
  TEST_TEAM_DOMAIN,
  accessClaims,
  jwksOf,
  makeTestSigner,
} from "../helpers/access-jwt.js"

const AGENT_TOKEN = "agent-token-for-tests"
const signer = await makeTestSigner("gate-key")
const nowSeconds = () => Math.floor(Date.now() / 1000)
const validToken = () => signer.sign(accessClaims(nowSeconds()))

// ── Hub under test ───────────────────────────────────────────────────────────

const TestConfigLayer = Layer.succeed(HubConfig)({
  host: "127.0.0.1",
  port: 0,
  agentToken: Redacted.make(AGENT_TOKEN),
  browserAuth: {
    _tag: "Access",
    teamDomain: TEST_TEAM_DOMAIN,
    audience: TEST_AUD,
    issuer: TEST_ISSUER,
    certsUrl: "http://jwks.invalid/certs",
  },
})

const TestBrowserAuthLayer = Layer.effect(
  BrowserAuth,
  Effect.gen(function* () {
    const keys = yield* makeAccessKeyStore({ fetchJwks: Effect.succeed(jwksOf(signer)) })
    return BrowserAuth.fromVerifier(makeAccessJwtVerifier({ issuer: TEST_ISSUER, audience: TEST_AUD, keys }))
  }),
)

const systemFor = (hostname: string): System => ({
  id: "identity-echo",
  hostname,
  tailscaleIp: null,
  status: "online",
  capabilities: {
    system: true,
    network: false,
    process: false,
    temperature: false,
    gpu: false,
    smart: false,
  },
  pluginCapabilities: [],
  lastSeen: 0,
  createdAt: 0,
})

// `systems.list` echoes the caller's identity; `systems.get` takes 3 s,
// standing in for a long unary call; `systems.subscribe` never ends on its
// own, standing in for a live subscription.
const StubClientHandlers = ClientHubRpcs.toLayer(
  Effect.succeed({
    ...Object.fromEntries(
      Array.from(ClientHubRpcs.requests.keys(), (tag) => [tag, () => Effect.die(`unexpected ${tag}`)]),
    ),
    "systems.list": () =>
      CurrentIdentity.use((identity) => Effect.succeed([systemFor(identity.email ?? identity.subject)])),
    "systems.get": ({ id }: { id: string }) => Effect.sleep("3 seconds").pipe(Effect.as(systemFor(id))),
    "systems.subscribe": () => Stream.never,
  } as never),
)

const StubRpcServer = RpcServer.layer(ClientHubRpcs).pipe(
  Layer.provide(StubClientHandlers),
  Layer.provide(ClientAuthMiddlewareLive),
  Layer.provide(RpcServer.layerProtocolWebsocket({ path: "/ws/rpc" })),
  Layer.provide(RpcSerialization.layerNdjson),
)

const StubAgentRoute = HttpRouter.add("GET", "/ws/rpc/agent", HttpServerResponse.text("agent route reached"))

const TestAppLayer = Layer.mergeAll(
  TestDatabaseLayer,
  MetricsBroadcast.layer,
  MetricsIngestion.layer.pipe(Layer.provide(TestDatabaseLayer)),
  AgentRegistry.layer.pipe(Layer.provide(TestDatabaseLayer)),
  AlertEngine.layer.pipe(Layer.provide(Layer.merge(TestDatabaseLayer, MetricsBroadcast.layer))),
  PluginRegistry.layer,
)

const ServeHub = Layer.mergeAll(AppRoutes, StubRpcServer, StubAgentRoute, HttpAuthGate).pipe(
  HttpRouter.serve,
  Layer.provide(TestBrowserAuthLayer),
  Layer.provide(TestConfigLayer),
  Layer.provideMerge(BunHttpServer.layerTest),
  Layer.provide(TestAppLayer),
)

// ── Helpers ──────────────────────────────────────────────────────────────────

const status = (path: string, headers: Record<string, string> = {}) =>
  HttpClient.execute(HttpClientRequest.get(path).pipe(HttpClientRequest.setHeaders(headers))).pipe(
    Effect.map((response) => response.status),
  )

const wsUrl = HttpServer.addressFormattedWith((url) => Effect.succeed(`${url.replace(/^http/, "ws")}/ws/rpc`))

/** Resolves "open" or "rejected" for a raw websocket upgrade attempt. */
const upgradeOutcome = (url: string, headers: Record<string, string>) =>
  Effect.promise(
    () =>
      new Promise<"open" | "rejected">((resolve) => {
        const socket = new WebSocket(url, { headers })
        socket.addEventListener("open", () => {
          resolve("open")
          socket.close()
        })
        socket.addEventListener("error", () => resolve("rejected"))
        socket.addEventListener("close", () => resolve("rejected"))
      }),
  )

const connectRpc = (token: string) =>
  Effect.gen(function* () {
    const url = yield* wsUrl
    const socket = yield* Socket.makeWebSocket(url).pipe(
      Effect.provideService(
        Socket.WebSocketConstructor,
        (target) => new globalThis.WebSocket(target, { headers: { "cf-access-jwt-assertion": token } }),
      ),
    )
    // Build the protocol in the caller's scope so its socket outlives `make`.
    const protocol = yield* Layer.build(
      RpcClient.layerProtocolSocket().pipe(
        Layer.provide(Layer.succeed(Socket.Socket)(socket)),
        Layer.provide(RpcSerialization.layerNdjson),
      ),
    )
    return yield* RpcClient.make(ClientHubRpcs).pipe(Effect.provide(protocol))
  })

// ── Tests ────────────────────────────────────────────────────────────────────

describe("HttpAuthGate", () => {
  it.live("keeps /health open", () =>
    Effect.gen(function* () {
      expect(yield* status("/health")).toBe(200)
    }).pipe(Effect.provide(ServeHub)),
  )

  it.live("rejects /api/* without a JWT and accepts header or cookie credentials", () =>
    Effect.gen(function* () {
      const token = yield* Effect.promise(validToken)
      expect(yield* status("/api/systems")).toBe(401)
      expect(yield* status("/api/systems", { "cf-access-jwt-assertion": "not-a-jwt" })).toBe(401)
      expect(yield* status("/api/systems", { "cf-access-jwt-assertion": token })).toBe(200)
      expect(yield* status("/api/alerts", { cookie: `CF_Authorization=${token}` })).toBe(200)
    }).pipe(Effect.provide(ServeHub)),
  )

  it.live("rejects an expired or foreign-audience JWT", () =>
    Effect.gen(function* () {
      const expired = yield* Effect.promise(() =>
        signer.sign(accessClaims(nowSeconds() - 7200, { exp: nowSeconds() - 3600 })),
      )
      const foreign = yield* Effect.promise(() =>
        signer.sign(accessClaims(nowSeconds(), { aud: ["some-other-app"] })),
      )
      expect(yield* status("/api/systems", { "cf-access-jwt-assertion": expired })).toBe(401)
      expect(yield* status("/api/systems", { "cf-access-jwt-assertion": foreign })).toBe(401)
    }).pipe(Effect.provide(ServeHub)),
  )

  it.live("fails closed for unknown paths", () =>
    Effect.gen(function* () {
      expect(yield* status("/not-a-route")).toBe(401)
    }).pipe(Effect.provide(ServeHub)),
  )

  it.live("requires the agent token on /ws/rpc/agent", () =>
    Effect.gen(function* () {
      expect(yield* status("/ws/rpc/agent")).toBe(401)
      expect(yield* status("/ws/rpc/agent", { authorization: "Bearer wrong" })).toBe(401)
      // A browser JWT is not an agent credential.
      const token = yield* Effect.promise(validToken)
      expect(yield* status("/ws/rpc/agent", { "cf-access-jwt-assertion": token })).toBe(401)
      expect(yield* status("/ws/rpc/agent", { authorization: `Bearer ${AGENT_TOKEN}` })).toBe(200)
    }).pipe(Effect.provide(ServeHub)),
  )

  it.live("rejects the /ws/rpc upgrade without a JWT", () =>
    Effect.gen(function* () {
      const url = yield* wsUrl
      expect(yield* status("/ws/rpc")).toBe(401)
      expect(yield* upgradeOutcome(url, {})).toBe("rejected")
      expect(yield* upgradeOutcome(url, { authorization: `Bearer ${AGENT_TOKEN}` })).toBe("rejected")
    }).pipe(Effect.provide(ServeHub)),
  )

  it.live("serves RPCs over an authenticated /ws/rpc and provides the identity", () =>
    Effect.gen(function* () {
      const client = yield* connectRpc(yield* Effect.promise(validToken))
      const systems = yield* client["systems.list"]().pipe(Effect.timeout("5 seconds"))
      expect(systems.map((system) => system.hostname)).toEqual([TEST_EMAIL])
    }).pipe(
      // Close the client socket before the server shuts down.
      Effect.scoped,
      Effect.provide(ServeHub),
    ),
  )

  it.live(
    "ends a live subscription when its JWT expires",
    () =>
      Effect.gen(function* () {
        // Accepted thanks to the 30 s clock-skew leeway, which runs out ~2 s from now.
        const token = yield* Effect.promise(() =>
          signer.sign(accessClaims(nowSeconds() - 3600, { exp: nowSeconds() - 28 })),
        )
        const client = yield* connectRpc(token)
        const exit = yield* client["systems.subscribe"]().pipe(
          Stream.runDrain,
          Effect.timeout("10 seconds"),
          Effect.exit,
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(String(Exit.isFailure(exit) ? exit.cause : "")).toContain("Cloudflare Access session expired")
      }).pipe(Effect.scoped, Effect.provide(ServeHub)),
    15_000,
  )

  it.live(
    "lets a unary call that started before expiry finish",
    () =>
      Effect.gen(function* () {
        const token = yield* Effect.promise(() =>
          signer.sign(accessClaims(nowSeconds() - 3600, { exp: nowSeconds() - 29 })),
        )
        const client = yield* connectRpc(token)
        const system = yield* client["systems.get"]({ id: "slow" }).pipe(Effect.timeout("10 seconds"))
        expect(system?.hostname).toBe("slow")
      }).pipe(Effect.scoped, Effect.provide(ServeHub)),
    15_000,
  )
})
