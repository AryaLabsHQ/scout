import { BunRuntime } from "@effect/platform-bun"
import { Effect, Layer, Stream } from "effect"
import { AgentConfig } from "./config.js"
import { CollectorRegistry } from "./services/collector-registry.js"
import { HubConnection, AgentCapabilitiesCtx } from "./services/hub-connection.js"
import { Reporter } from "./services/reporter.js"

const program = Effect.gen(function* () {
  // 1. Load config
  const config = yield* AgentConfig.load

  yield* Effect.log("Scout Agent starting", {
    hostname: config.hostname,
    hubUrl: config.hubUrl,
    interval: config.interval,
  })

  // 2. Build CollectorRegistry and discover capabilities
  const registry = yield* CollectorRegistry
  const capabilities = yield* registry.discover()

  yield* Effect.log("Discovered capabilities", capabilities)

  // 3. HubConnection (uses discovered capabilities via AgentCapabilitiesCtx in layer)
  const hub = yield* HubConnection

  yield* Effect.log("HubConnection initialized")

  // 4. Build Reporter
  const reporter = yield* Reporter

  // 5. Start Reporter fiber (detached — runs forever)
  yield* reporter.run.pipe(Effect.forkDetach)

  yield* Effect.log("Reporter started", { intervalSeconds: config.interval })

  // 6. CommandHandler stub — log incoming commands from hub
  yield* Stream.runForEach(hub.onMessage, (msg) =>
    Effect.log("CommandHandler: received message", {
      type: "method" in msg ? msg.method : "event" in msg ? msg.event : "response",
    })
  ).pipe(Effect.forkDetach)

  yield* Effect.log("Agent running", {
    hostname: config.hostname,
    hubUrl: config.hubUrl,
  })

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
const baseLayer = Layer.mergeAll(
  CollectorRegistry.layer,
  HubConnection.layer.pipe(Layer.provide(defaultCapabilitiesLayer)),
)

const appLayer = Layer.mergeAll(
  baseLayer,
  Reporter.layer.pipe(Layer.provide(baseLayer)),
)

BunRuntime.runMain(
  program.pipe(Effect.provide(appLayer))
)
