import { Config, Effect, Layer } from "effect"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { AppLayer } from "./app.js"
import { AppRoutes } from "./routes.js"
import { Retention } from "./services/retention.js"

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

const AppServerLayer = AppRoutes.pipe(
  HttpRouter.serve,
  Layer.provide(ServerLayer),
)

const FullLayer = AppServerLayer.pipe(
  Layer.merge(RetentionBackgroundLayer),
  Layer.provide(AppLayer),
)

// ── Run ───────────────────────────────────────────────────────────────────────

const program = Layer.launch(FullLayer)

BunRuntime.runMain(program)
