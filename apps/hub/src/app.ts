import { Layer } from "effect"
import { Database } from "./services/database.js"
import { MetricsIngestion } from "./services/metrics-ingestion.js"
import { MetricsBroadcast } from "./services/metrics-broadcast.js"
import { AgentManager } from "./services/agent-manager.js"
import { Retention } from "./services/retention.js"
import { LogService } from "./services/log-service.js"

// ── Layer 0: Infrastructure (no deps within AppLayer) ───────────────────────

const DatabaseLayer = Database.layer
const BroadcastLayer = MetricsBroadcast.layer

// ── Layer 1: Core services (depend on Database) ───────────────────────────

const IngestionLayer = MetricsIngestion.layer.pipe(Layer.provide(DatabaseLayer))
const AgentManagerLayer = AgentManager.layer.pipe(Layer.provide(DatabaseLayer))
const RetentionLayer = Retention.layer.pipe(Layer.provide(DatabaseLayer))

// ── Layer 2: Services that depend on AgentManager ────────────────────────

const LogServiceLayer = LogService.layer.pipe(Layer.provide(AgentManagerLayer))

// ── AppLayer: merge everything ────────────────────────────────────────────

export const AppLayer = Layer.mergeAll(
  DatabaseLayer,
  BroadcastLayer,
  IngestionLayer,
  AgentManagerLayer,
  RetentionLayer,
  LogServiceLayer,
)
