import { Effect, Layer, Logger } from "effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpRouter from "effect/http/HttpRouter"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { AppLayer } from "./app.js"
import { BrowserAuth } from "./auth/browser-auth.js"
import { HttpAuthGate } from "./auth/http-gate.js"
import { HubConfig } from "./config.js"
import { AppRoutes } from "./routes.js"
import { Retention } from "./services/retention.js"
import { RpcLayer } from "./rpc/server.js"

// ── Structured logging ────────────────────────────────────────────────────────

// Use JSON logger in production; default pretty logger otherwise.
// Log level is controlled by SCOUT_LOG_LEVEL env var (debug|info|warn|error).
// Effect's built-in logger respects the SCOUT_LOG_LEVEL via the consolePretty logger
// which reads from the environment at startup.
const LoggingLayer: Layer.Layer<never, never, never> = process.env["NODE_ENV"] === "production"
  ? Logger.layer([Logger.consoleJson])
  : Layer.empty

// ── Configuration + auth ─────────────────────────────────────────────────────

// HubConfig fails the launch on invalid or missing settings (fail closed).
const ConfigLayer = HubConfig.layer

const AuthLayer = BrowserAuth.layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provideMerge(ConfigLayer),
)

// ── Server layer ─────────────────────────────────────────────────────────────

const ServerLayer = Effect.gen(function* () {
  const { host, port } = yield* HubConfig
  yield* Effect.logInfo("Scout hub listening", { host, port })
  return BunHttpServer.layer({ hostname: host, port })
}).pipe(Layer.unwrap, Layer.provide(ConfigLayer))

// ── Retention background fiber ────────────────────────────────────────────────

const RetentionBackgroundLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const retention = yield* Retention
    yield* Effect.forkScoped(retention.runForever())
  }),
)

// ── Full application ──────────────────────────────────────────────────────────

// Merge RPC routes alongside existing routes so both use the same HttpRouter.
// RpcLayer bundles the client-facing /ws/rpc server + AgentRegistry + /ws/rpc/agent route.
// HttpAuthGate is global middleware: it authenticates every path except /health.
const AllRoutes = Layer.mergeAll(AppRoutes, RpcLayer, HttpAuthGate)

const AppServerLayer = AllRoutes.pipe(
  HttpRouter.serve,
  Layer.provide(ServerLayer),
  Layer.provide(AppLayer),
  Layer.provide(AuthLayer),
)

const FullLayer = Layer.merge(
  AppServerLayer,
  RetentionBackgroundLayer.pipe(Layer.provide(AppLayer)),
).pipe(Layer.provide(LoggingLayer))

// ── Run ───────────────────────────────────────────────────────────────────────

const program = Layer.launch(FullLayer)

BunRuntime.runMain(program)
