import { Layer } from "effect"
import { Database } from "./services/database.js"
import { MetricsIngestion } from "./services/metrics-ingestion.js"
import { MetricsBroadcast } from "./services/metrics-broadcast.js"
import { Retention } from "./services/retention.js"
import { AlertEngine } from "./services/alert-engine.js"
import { PluginRegistry } from "./services/plugin-registry.js"
import { AgentRegistry } from "./rpc/agent-bridge.js"

// ── Layer 0: Infrastructure (no deps within AppLayer) ───────────────────────

const DatabaseLayer = Database.layer
const BroadcastLayer = MetricsBroadcast.layer

// ── Layer 1: Core services (depend on Database) ───────────────────────────

const IngestionLayer = MetricsIngestion.layer.pipe(Layer.provide(DatabaseLayer))
const RetentionLayer = Retention.layer.pipe(Layer.provide(DatabaseLayer))

// ── Layer 2: AlertEngine (depends on Database + MetricsBroadcast) ─────────

const AlertEngineLayer = AlertEngine.layer.pipe(
  Layer.provide(Layer.merge(DatabaseLayer, BroadcastLayer)),
)

// ── Layer 3: AgentRegistry (depends on Database) ──────────────────────────

const AgentRegistryLayer = AgentRegistry.layer.pipe(Layer.provide(DatabaseLayer))
const PluginRegistryLayer = PluginRegistry.layer

// ── AppLayer: merge everything ────────────────────────────────────────────

export const AppLayer = Layer.mergeAll(
  DatabaseLayer,
  BroadcastLayer,
  IngestionLayer,
  RetentionLayer,
  AlertEngineLayer,
  AgentRegistryLayer,
  PluginRegistryLayer,
)
