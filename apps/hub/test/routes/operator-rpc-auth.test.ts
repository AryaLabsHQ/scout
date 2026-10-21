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
import {
  TEST_AUD,
  TEST_EMAIL,
  TEST_ISSUER,
  TEST_TEAM_DOMAIN,
  accessClaims,
  jwksOf,
  makeTestSigner,
} from "../helpers/access-jwt.js"
import { executed, faux, operatorLayer } from "../helpers/operator.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"

const signer = await makeTestSigner("operator-key")
const nowSeconds = () => Math.floor(Date.now() / 1000)
const directory = mkdtempSync(join(tmpdir(), "scout-operator-rpc-"))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

const TestConfigLayer = Layer.succeed(HubConfig)({
  host: "127.0.0.1",
  port: 0,
  agentTokens: new Map([["test-agent", Redacted.make("agent-token-for-tests")]]),
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

const serveHub = (storagePath: string, modelId = "faux-1") => {
  const services = Layer.mergeAll(
    operatorLayer(storagePath, modelId),
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

const connectRpc = (token: string, loseFirstResponse = false) =>
  Effect.gen(function* () {
    const url = yield* HttpServer.addressFormattedWith((address) =>
      Effect.succeed(`${address.replace(/^http/, "ws")}/ws/rpc`),
    )
    const socket = yield* Socket.makeWebSocket(url).pipe(
      Effect.provideService(Socket.WebSocketConstructor, (target) => {
        const socket = new globalThis.WebSocket(target, { headers: { "cf-access-jwt-assertion": token } })
        if (loseFirstResponse)
          socket.addEventListener(
            "message",
            (event) => {
              // Lose the native RPC acknowledgement after the real handler has durably admitted the input.
              event.stopImmediatePropagation()
              socket.close(1000, "fixture lost response")
            },
            { once: true },
          )
        return socket
      }),
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
  it.live(
    "records the verified identity as the approval actor",
    () =>
      Effect.gen(function* () {
        executed.length = 0
        faux.setResponses([
          fauxAssistantMessage(
            fauxToolCall("bash_run", {
              nodeId: "node-a",
              label: "restart",
              command: "restart",
              isMutation: true,
            }),
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
        const done = yield* waitUntil(
          (detail) => detail.session.status === "idle" && detail.approvals[0]?.status === "approved",
        )
        expect(done.approvals[0]?.actor).toBe(TEST_EMAIL)
        expect(executed).toEqual(["bash:restart"])
      }).pipe(Effect.scoped, Effect.provide(serveHub(join(directory, "actor.sqlite")))),
    20_000,
  )

  it.live(
    "ends a session watch with Unauthorized when its JWT expires",
    () =>
      Effect.gen(function* () {
        const fresh = yield* connectRpc(yield* Effect.promise(() => signer.sign(accessClaims(nowSeconds()))))
        const created = yield* fresh["operator.sessions.create"]({ selectedNodeIds: ["node-a"] })
        // Accepted thanks to the 30 s clock-skew leeway, which runs out ~2 s from now.
        const expiring = yield* connectRpc(
          yield* Effect.promise(() =>
            signer.sign(accessClaims(nowSeconds() - 3600, { exp: nowSeconds() - 28 })),
          ),
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
  it.live(
    "admits native images over two authenticated peers and confines lazy retrieval",
    () =>
      Effect.gen(function* () {
        const { png } = yield* Effect.promise(() => import("../helpers/operator-images.js"))
        const seen: Array<unknown> = []
        faux.setResponses([
          (context) => {
            seen.push(context.messages.find((message) => message.role === "user")?.content)
            return fauxAssistantMessage("Image received")
          },
        ])
        const token = yield* Effect.promise(() => signer.sign(accessClaims(nowSeconds())))
        const first = yield* connectRpc(token)
        const second = yield* connectRpc(
          yield* Effect.promise(() =>
            signer.sign(accessClaims(nowSeconds(), { sub: "second-peer", email: "second@example.com" })),
          ),
        )
        const { session } = yield* first["operator.sessions.create"]({})
        const payload = { sessionId: session.id, text: "", images: [png], requestId: "lost-ack-image" }
        const disconnected = yield* connectRpc(token, true)
        const lostResponse = yield* disconnected["operator.prompt"](payload).pipe(Effect.exit)
        expect(Exit.isFailure(lostResponse)).toBe(true)
        // The first peer received no acknowledgement; another authenticated connection retries unchanged.
        yield* second["operator.prompt"](payload)
        let entryId = ""
        for (let i = 0; i < 300; i++) {
          const detail = yield* second["operator.sessions.get"]({ sessionId: session.id })
          const users = detail?.timeline.filter((item) => item.kind === "user") ?? []
          if (detail?.session.status === "idle" && users.length > 0) {
            expect(users).toHaveLength(1)
            entryId = users[0]!.entryId
            expect(JSON.stringify(detail)).not.toContain(png.data)
            break
          }
          yield* Effect.sleep("10 millis")
        }
        expect(entryId).not.toBe("")
        expect(seen).toEqual([[{ type: "image", ...png }]])
        expect(
          yield* second["operator.images.get"]({ sessionId: session.id, entryId, imageIndex: 0 }),
        ).toEqual(png)
        const snapshot = yield* first["operator.sessions.watch"]({ sessionId: session.id }).pipe(
          Stream.take(1),
          Stream.runCollect,
        )
        expect(JSON.stringify(snapshot)).not.toContain(png.data)
        const other = yield* first["operator.sessions.create"]({})
        for (const params of [
          { sessionId: other.session.id, entryId, imageIndex: 0 },
          { sessionId: session.id, entryId, imageIndex: 1 },
          { sessionId: session.id, entryId, imageIndex: -1 },
        ]) {
          const error = yield* second["operator.images.get"](params).pipe(Effect.flip)
          expect(error).toMatchObject({ code: "image-not-found" })
        }
        const changed = yield* second["operator.prompt"]({ ...payload, text: "edited" }).pipe(Effect.flip)
        expect(changed).toMatchObject({ code: "operator-request-conflict" })
        for (const invalid of [
          { ...payload, requestId: "invalid-base64", images: [{ ...png, data: "bad" }] },
          { ...payload, requestId: "remote", images: [{ ...png, data: "https://example.com/a.png" }] },
          { ...payload, requestId: "mime", images: [{ ...png, mimeType: "image/svg+xml" }] },
          { ...payload, requestId: "count", images: Array(5).fill(png) },
          {
            ...payload,
            requestId: "size",
            images: [{ ...png, data: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64") }],
          },
          { ...payload, requestId: "serialized", text: "x".repeat(6 * 1024 * 1024) },
        ])
          expect(yield* second["operator.prompt"](invalid).pipe(Effect.flip)).toMatchObject({
            code: "operator-input-invalid",
          })
        const expired = yield* connectRpc(
          yield* Effect.promise(() =>
            signer.sign(accessClaims(nowSeconds() - 3600, { exp: nowSeconds() - 31 })),
          ),
        )
        const denied = yield* expired["operator.images.get"]({
          sessionId: session.id,
          entryId,
          imageIndex: 0,
        }).pipe(Effect.exit)
        expect(Exit.isFailure(denied)).toBe(true)
      }).pipe(Effect.scoped, Effect.provide(serveHub(join(directory, "images.sqlite")))),
    20_000,
  )

  it.live(
    "rejects corrupt compressed pixels before admission or provider execution over real RPC",
    () =>
      Effect.gen(function* () {
        const { corruptCompressedImages, png } = yield* Effect.promise(
          () => import("../helpers/operator-images.js"),
        )
        let calls = 0
        faux.setResponses([
          (context) => {
            calls++
            expect(context.messages.find((message) => message.role === "user")?.content).toEqual([
              { type: "image", ...png },
            ])
            return fauxAssistantMessage("Valid retry")
          },
        ])
        const client = yield* connectRpc(yield* Effect.promise(() => signer.sign(accessClaims(nowSeconds()))))
        const { session } = yield* client["operator.sessions.create"]({})
        for (const image of corruptCompressedImages) {
          expect(
            yield* client["operator.prompt"]({
              sessionId: session.id,
              text: "",
              images: [image],
              requestId: "rejected",
            }).pipe(Effect.flip),
          ).toMatchObject({ code: "operator-input-invalid" })
          const detail = yield* client["operator.sessions.get"]({ sessionId: session.id })
          expect(detail?.timeline).toEqual([])
          expect(detail?.queuedInputs).toBe(0)
          expect(detail?.session.status).toBe("idle")
          expect(calls).toBe(0)
        }
        // Rejection must not reserve the key. An edited valid envelope can still use it.
        yield* client["operator.prompt"]({
          sessionId: session.id,
          text: "",
          images: [png],
          requestId: "rejected",
        })
        for (let i = 0; i < 300; i++) {
          if (calls > 0) break
          yield* Effect.sleep("10 millis")
        }
        expect(calls).toBe(1)
      }).pipe(Effect.scoped, Effect.provide(serveHub(join(directory, "compressed-corruption.sqlite")))),
    20_000,
  )

  it.live(
    "rejects images for a text-only session at the real RPC boundary",
    () =>
      Effect.gen(function* () {
        const { png } = yield* Effect.promise(() => import("../helpers/operator-images.js"))
        const client = yield* connectRpc(yield* Effect.promise(() => signer.sign(accessClaims(nowSeconds()))))
        const { session, imageInput } = yield* client["operator.sessions.create"]({})
        expect(imageInput.supported).toBe(false)
        const error = yield* client["operator.prompt"]({
          sessionId: session.id,
          text: "",
          images: [png],
        }).pipe(Effect.flip)
        expect(error).toMatchObject({ code: "operator-input-invalid" })
        expect((yield* client["operator.sessions.get"]({ sessionId: session.id }))?.timeline).toEqual([])
      }).pipe(Effect.scoped, Effect.provide(serveHub(join(directory, "text-model.sqlite"), "faux-text"))),
    20_000,
  )
  it.live(
    "bounds real transport bytes and keeps large images out of watch snapshots",
    () =>
      Effect.gen(function* () {
        const { paddedPng } = yield* Effect.promise(() => import("../helpers/operator-images.js"))
        const large = paddedPng(2 * 1024 * 1024)
        faux.setResponses([
          (context) => {
            const user = context.messages.find((message) => message.role === "user")
            expect(user?.content).toEqual([
              { type: "image", ...large },
              { type: "image", ...large },
            ])
            return fauxAssistantMessage("Large images received")
          },
        ])
        const client = yield* connectRpc(yield* Effect.promise(() => signer.sign(accessClaims(nowSeconds()))))
        const { session } = yield* client["operator.sessions.create"]({})
        yield* client["operator.prompt"]({
          sessionId: session.id,
          text: "",
          requestId: "max-valid",
          images: [large, large],
        })
        const snapshots = yield* client["operator.sessions.watch"]({ sessionId: session.id }).pipe(
          Stream.take(1),
          Stream.runCollect,
        )
        expect(Buffer.byteLength(JSON.stringify(snapshots))).toBeLessThan(20_000)
        expect(JSON.stringify(snapshots)).not.toContain(large.data)
        const medium = paddedPng(1_100_000)
        const error = yield* client["operator.prompt"]({
          sessionId: session.id,
          text: "",
          requestId: "decoded-total",
          images: [medium, medium, medium, medium],
        }).pipe(Effect.flip)
        expect(error).toMatchObject({ code: "operator-input-invalid" })
        expect(error.message).toContain("combined decoded")
        const missing = yield* connectRpc("")
        const denied = yield* missing["operator.images.get"]({
          sessionId: session.id,
          entryId: "1",
          imageIndex: 0,
        }).pipe(Effect.exit)
        expect(Exit.isFailure(denied)).toBe(true)
      }).pipe(Effect.scoped, Effect.provide(serveHub(join(directory, "image-byte-limits.sqlite")))),
    20_000,
  )
})
