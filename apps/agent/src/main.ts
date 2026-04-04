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

  // 2. Build CollectorRegistry and discover capabilities
  const registry = yield* CollectorRegistry
  const capabilities = yield* registry.discover()

  yield* Effect.logInfo("Discovered capabilities").pipe(
    Effect.annotateLogs({ capabilities: JSON.stringify(capabilities) }),
  )

  // 3. HubConnection (uses discovered capabilities via AgentCapabilitiesCtx in layer)
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

// Default capabilities for the layer graph. HubConnection needs this context at startup.
const defaultCapabilitiesLayer = Layer.succeed(AgentCapabilitiesCtx)({
  system: true,
  network: true,
  process: false,
  temperature: false,
  gpu: false,
  smart: false,
  systemd: false,
  docker: false,
  k8s: false,
})

// Layer dependencies:
//   CollectorRegistry ← (no extra deps)
//   HubConnection ← AgentCapabilitiesCtx
//   Reporter ← HubConnection + CollectorRegistry
//   CommandHandler ← HubConnection
const hubConnectionLayer = HubConnection.layer.pipe(Layer.provide(defaultCapabilitiesLayer))

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
