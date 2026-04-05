import { BunRuntime } from "@effect/platform-bun"
import { Config, Effect, Layer, Logger, References } from "effect"
import type { LogLevel } from "effect/LogLevel"
import { AgentConfig } from "./config.js"
import { CollectorRegistry } from "./services/collector-registry.js"
import { Reporter } from "./services/reporter.js"
import { HubConnectionLayer } from "./rpc/connection.js"
import { HubAgentHandlersLive } from "./rpc/handlers.js"

// ── Structured logging ────────────────────────────────────────────────────────

const LogLevelLayer = Layer.unwrap(
  Effect.gen(function* () {
    const levelStr = yield* Config.withDefault(Config.string("SCOUT_LOG_LEVEL"), "info")
    const level = levelStr.toLowerCase()
    let logLevel: LogLevel = "Info"
    if (level === "debug") logLevel = "Debug"
    else if (level === "warn" || level === "warning") logLevel = "Warn"
    else if (level === "error") logLevel = "Error"
    return Layer.succeed(References.MinimumLogLevel, logLevel)
  }),
)

const JsonLogLayer = process.env["NODE_ENV"] === "production"
  ? Logger.layer([Logger.consoleJson])
  : Layer.empty

const LoggingLayer = Layer.merge(LogLevelLayer, JsonLogLayer)

// ── Program ───────────────────────────────────────────────────────────────────

const program = Effect.gen(function* () {
  const config = yield* AgentConfig.load

  yield* Effect.logInfo("Scout Agent starting").pipe(
    Effect.annotateLogs({
      hostname: config.hostname,
      hubUrl: config.hubUrl,
      interval: String(config.interval),
    }),
  )

  // Reporter runs forever; fork it so we don't block here
  const reporter = yield* Reporter
  yield* reporter.run.pipe(Effect.forkDetach)

  yield* Effect.logInfo("Agent running").pipe(
    Effect.annotateLogs({ hostname: config.hostname }),
  )

  yield* Effect.never
})

// ── Layer stack ───────────────────────────────────────────────────────────────

const CollectorRegistryLayer = CollectorRegistry.layer

// HubAgentHandlersLive needs no services from the app layer itself
const HandlersLayer = HubAgentHandlersLive

// HubConnectionLayer needs: AgentConfig, CollectorRegistry, HubAgentRpcs handlers
const ConnectionLayer = HubConnectionLayer.pipe(
  Layer.provide(CollectorRegistryLayer),
  Layer.provide(HandlersLayer),
)

// Reporter needs: AgentConfig, HubClient (from ConnectionLayer), CollectorRegistry
const ReporterLayer = Reporter.layer.pipe(
  Layer.provide(ConnectionLayer),
  Layer.provide(CollectorRegistryLayer),
)

const AppLayer = Layer.mergeAll(
  CollectorRegistryLayer,
  ConnectionLayer,
  ReporterLayer,
)

BunRuntime.runMain(
  program.pipe(
    Effect.provide(AppLayer),
    Effect.provide(LoggingLayer),
  ),
)
