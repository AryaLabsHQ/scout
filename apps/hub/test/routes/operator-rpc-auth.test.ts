/**
 * Operator RPCs behind Cloudflare Access over a real Bun server: an approval
 * decision records the verified identity as its actor, and a session watch
 * ends with Unauthorized when its JWT expires.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Layer, Redacted, Stream } from "effect"
import { BunHttpServer } from "@effect/platform-bun"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServer from "effect/http/HttpServer"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"
import * as Socket from "effect/socket/Socket"
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { ClientHubRpcs, type OperatorSessionDetail } from "@scout/shared"
import { makeAccessJwtVerifier, makeAccessKeyStore } from "../../src/auth/access-jwt.js"
import { BrowserAuth } from "../../src/auth/browser-auth.js"
import { HttpAuthGate } from "../../src/auth/http-gate.js"
import { HubConfig } from "../../src/config.js"
import { ClientAuthMiddlewareLive } from "../../src/rpc/auth.js"
import { ClientHandlersLive } from "../../src/rpc/client-handlers.js"
import { AlertEngine } from "../../src/services/alert-engine.js"
import { MetricsBroadcast } from "../../src/services/metrics-broadcast.js"
import { TEST_AUD, TEST_EMAIL, TEST_ISSUER, TEST_TEAM_DOMAIN, accessClaims, jwksOf, makeTestSigner } from "../helpers/access-jwt.js"
import { executed, faux, operatorLayer } from "../helpers/operator.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"

const signer = await makeTestSigner("operator-key")
const nowSeconds = () => Math.floor(Date.now() / 1000)
const directory = mkdtempSync(join(tmpdir(), "scout-operator-rpc-"))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

const TestConfigLayer = Layer.succeed(HubConfig)({
  host: "127.0.0.1",
  port: 0,
  agentToken: Redacted.make("agent-token-for-tests"),
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
    Layer.provide(TestBrowserAuthLayer),
    Layer.provide(TestConfigLayer),
    Layer.provideMerge(BunHttpServer.layerTest),
    Layer.provide(services),
  )
}

const connectRpc = (token: string) =>
  Effect.gen(function* () {
    const url = yield* HttpServer.addressFormattedWith((address) =>
      Effect.succeed(`${address.replace(/^http/, "ws")}/ws/rpc`),
    )
    const socket = yield* Socket.makeWebSocket(url).pipe(
      Effect.provideService(
        Socket.WebSocketConstructor,
        (target) => new globalThis.WebSocket(target, { headers: { "cf-access-jwt-assertion": token } }),
      ),
    )
    const protocol = yield* Layer.build(
      RpcClient.layerProtocolSocket().pipe(
        Layer.provide(Layer.succeed(Socket.Socket)(socket)),
        Layer.provide(RpcSerialization.layerNdjson),
      ),
    )
    return yield* RpcClient.make(ClientHubRpcs).pipe(Effect.provide(protocol))
  })

describe("operator RPCs behind Cloudflare Access", () => {
  it.live("records the verified identity as the approval actor", () =>
    Effect.gen(function* () {
      executed.length = 0
      faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall("bash_run", { nodeId: "node-a", label: "restart", command: "restart", isMutation: true }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("Restarted."),
      ])
      const client = yield* connectRpc(yield* Effect.promise(() => signer.sign(accessClaims(nowSeconds()))))
      const created = yield* client["operator.sessions.create"]({ selectedNodeIds: ["node-a"] })
      const sessionId = created.session.id
      yield* client["operator.prompt"]({ sessionId, text: "Restart it" })

      const waitUntil = (predicate: (detail: OperatorSessionDetail) => boolean) =>
        Effect.gen(function* () {
          for (let attempt = 0; attempt < 300; attempt++) {
            const detail = yield* client["operator.sessions.get"]({ sessionId })
            if (detail !== null && predicate(detail)) return detail
            yield* Effect.sleep("10 millis")
          }
          return yield* Effect.die("timed out")
        })

      const waiting = yield* waitUntil((detail) => detail.approvals[0]?.status === "pending")
      expect(executed).toEqual([])
      yield* client["operator.approvals.resolve"]({
        sessionId,
        approvalId: waiting.approvals[0]!.id,
        decision: "approved",
      })
      const done = yield* waitUntil((detail) => detail.session.status === "idle" && detail.approvals[0]?.status === "approved")
      expect(done.approvals[0]?.actor).toBe(TEST_EMAIL)
      expect(executed).toEqual(["bash:restart"])
    }).pipe(Effect.scoped, Effect.provide(serveHub(join(directory, "actor.sqlite")))),
    20_000,
  )

  it.live("ends a session watch with Unauthorized when its JWT expires", () =>
    Effect.gen(function* () {
      const fresh = yield* connectRpc(yield* Effect.promise(() => signer.sign(accessClaims(nowSeconds()))))
      const created = yield* fresh["operator.sessions.create"]({ selectedNodeIds: ["node-a"] })
      // Accepted thanks to the 30 s clock-skew leeway, which runs out ~2 s from now.
      const expiring = yield* connectRpc(
        yield* Effect.promise(() => signer.sign(accessClaims(nowSeconds() - 3600, { exp: nowSeconds() - 28 }))),
      )
      let frames = 0
      const exit = yield* expiring["operator.sessions.watch"]({ sessionId: created.session.id }).pipe(
        Stream.runForEach(() => Effect.sync(() => void frames++)),
        Effect.timeout("10 seconds"),
        Effect.exit,
      )
      expect(frames).toBeGreaterThan(0)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(String(Exit.isFailure(exit) ? exit.cause : "")).toContain("Cloudflare Access session expired")
    }).pipe(Effect.scoped, Effect.provide(serveHub(join(directory, "watch.sqlite")))),
    20_000,
  )
})
