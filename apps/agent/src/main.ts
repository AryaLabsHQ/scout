import { BunRuntime } from "@effect/platform-bun"
import { Config, Effect, Layer, Logger, References } from "effect"
import type { LogLevel } from "effect/LogLevel"
import { AgentConfig } from "./config.js"
import { CollectorRegistry } from "./services/collector-registry.js"
import { HubConnection, AgentCapabilitiesCtx } from "./services/hub-connection.js"
import { Reporter } from "./services/reporter.js"
import { CommandHandler } from "./services/command-handler.js"

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
  // 1. Load config
  const config = yield* AgentConfig.load

  yield* Effect.logInfo("Scout Agent starting").pipe(
    Effect.annotateLogs({
      hostname: config.hostname,
      hubUrl: config.hubUrl,
      interval: String(config.interval),
    }),
  )

  // 2. HubConnection (discovers capabilities + connects as part of layer construction)
  yield* HubConnection

  yield* Effect.logInfo("Connected to hub").pipe(
    Effect.annotateLogs({ hubUrl: config.hubUrl }),
  )

  // 4. Build Reporter
  const reporter = yield* Reporter

  // 5. Start Reporter fiber (detached — runs forever)
  yield* reporter.run.pipe(Effect.forkDetach)

  yield* Effect.logInfo("Reporter started").pipe(
    Effect.annotateLogs({ intervalSeconds: String(config.interval) }),
  )

  // 6. CommandHandler — handle incoming commands from hub (log streaming, etc.)
  const cmdHandler = yield* CommandHandler
  yield* cmdHandler.run.pipe(Effect.forkDetach)

  yield* Effect.logInfo("Agent running").pipe(
    Effect.annotateLogs({ hostname: config.hostname, hubUrl: config.hubUrl }),
  )

  // Keep running forever
  yield* Effect.never
})

// ── Layer stack ───────────────────────────────────────────────────────────────

// HubConnection needs discovered capabilities at startup.
// Use Layer.unwrap to run discovery as part of layer construction.
const hubConnectionLayer = Layer.unwrap(
  Effect.gen(function* () {
    const registry = yield* CollectorRegistry
    const capabilities = yield* registry.discover()
    yield* Effect.logInfo("Discovered capabilities").pipe(
      Effect.annotateLogs({ capabilities: JSON.stringify(capabilities) }),
    )
    const capsLayer = Layer.succeed(AgentCapabilitiesCtx)(capabilities)
    return HubConnection.layer.pipe(Layer.provide(capsLayer))
  }),
).pipe(Layer.provide(CollectorRegistry.layer))

const baseLayer = Layer.mergeAll(
  CollectorRegistry.layer,
  hubConnectionLayer,
)

const appLayer = Layer.mergeAll(
  baseLayer,
  Reporter.layer.pipe(Layer.provide(baseLayer)),
  CommandHandler.layer.pipe(Layer.provide(hubConnectionLayer)),
)

BunRuntime.runMain(
  program.pipe(
    Effect.provide(appLayer),
    Effect.provide(LoggingLayer),
  )
)
