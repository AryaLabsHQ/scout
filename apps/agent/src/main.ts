import { BunRuntime } from "@effect/platform-bun"
import { Config, Effect, Layer, Logger, References } from "effect"
import type { LogLevel } from "effect/LogLevel"
import { AgentConfig } from "./config.js"
import { CollectorRegistry } from "./services/collector-registry.js"
import { AgentPluginHost } from "./services/plugin-host.js"
import { AgentPluginRegistry } from "./services/plugin-registry.js"
import { Reporter } from "./services/reporter.js"
import { HubConnectionLayer } from "./rpc/connection.js"
import { HubAgentHandlersLive } from "./rpc/handlers.js"

// ── Structured logging ────────────────────────────────────────────────────────

const LogLevelLayer = Layer.unwrap(
  Effect.gen(function* () {
    const levelStr = yield* Config.withDefault(Config.String("SCOUT_LOG_LEVEL"), "info")
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
  const pluginRegistry = yield* AgentPluginRegistry
  const plugins = yield* pluginRegistry.list()

  yield* Effect.logInfo("Scout Agent starting").pipe(
    Effect.annotateLogs({
      hostname: config.hostname,
      hubUrl: config.hubUrl,
      interval: String(config.interval),
      pluginDir: config.pluginDir,
      plugins: plugins.map((plugin) => plugin.manifest.id).join(","),
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

const PluginRegistryLayer = AgentPluginRegistry.layer
const PluginHostLayer = AgentPluginHost.layer.pipe(
  Layer.provide(PluginRegistryLayer),
)
const CollectorRegistryLayer = CollectorRegistry.layer.pipe(
  Layer.provide(PluginHostLayer),
)

// HubAgentHandlersLive needs no services from the app layer itself
const HandlersLayer = HubAgentHandlersLive.pipe(
  Layer.provide(PluginHostLayer),
)

// HubConnectionLayer needs: AgentConfig, CollectorRegistry, PluginHost, HubAgentRpcs handlers
const ConnectionLayer = HubConnectionLayer.pipe(
  Layer.provide(CollectorRegistryLayer),
  Layer.provide(PluginHostLayer),
  Layer.provide(HandlersLayer),
)

// Reporter needs: AgentConfig, HubClient (from ConnectionLayer), CollectorRegistry, PluginHost
const ReporterLayer = Reporter.layer.pipe(
  Layer.provide(ConnectionLayer),
  Layer.provide(CollectorRegistryLayer),
  Layer.provide(PluginHostLayer),
)

const AppLayer = Layer.mergeAll(
  PluginRegistryLayer,
  PluginHostLayer,
  CollectorRegistryLayer,
  ConnectionLayer,
  ReporterLayer,
)

const MainProgram = program.pipe(
  Effect.provide(PluginHostLayer),
  Effect.provide(AppLayer),
  Effect.provide(LoggingLayer),
) as Effect.Effect<void, unknown, never>

BunRuntime.runMain(
  MainProgram,
)
