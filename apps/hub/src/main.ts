import { Config, Effect, Layer, Logger } from "effect"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { AppLayer } from "./app.js"
import { AppRoutes } from "./routes.js"
import { Retention } from "./services/retention.js"
import { ClientRpcServerLayer } from "./rpc/server.js"

// ── Structured logging ────────────────────────────────────────────────────────

// Use JSON logger in production; default pretty logger otherwise.
// Log level is controlled by SCOUT_LOG_LEVEL env var (debug|info|warn|error).
// Effect's built-in logger respects the SCOUT_LOG_LEVEL via the consolePretty logger
// which reads from the environment at startup.
const LoggingLayer: Layer.Layer<never, never, never> = process.env["NODE_ENV"] === "production"
  ? Logger.layer([Logger.consoleJson])
  : Layer.empty

// ── Server layer ─────────────────────────────────────────────────────────────

const ServerLayer = Effect.gen(function* () {
  const port = yield* Config.withDefault(Config.number("SCOUT_PORT"), 3001)
  return BunHttpServer.layer({ port: Math.round(port) })
}).pipe(Layer.unwrap)

// ── Retention background fiber ────────────────────────────────────────────────

const RetentionBackgroundLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const retention = yield* Retention
    yield* Effect.forkScoped(retention.runForever())
  }),
)

// ── Full application ──────────────────────────────────────────────────────────

// Merge RPC routes alongside existing routes so both use the same HttpRouter
const AllRoutes = Layer.merge(AppRoutes, ClientRpcServerLayer)

const AppServerLayer = AllRoutes.pipe(
  HttpRouter.serve,
  Layer.provide(ServerLayer),
)

const FullLayer = AppServerLayer.pipe(
  Layer.merge(RetentionBackgroundLayer),
  Layer.provide(AppLayer),
  Layer.provide(LoggingLayer),
)

// ── Run ───────────────────────────────────────────────────────────────────────

const program = Layer.launch(FullLayer)

BunRuntime.runMain(program)
