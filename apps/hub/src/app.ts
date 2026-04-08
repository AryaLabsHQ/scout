import { Layer } from "effect"
import { OperatorExtensions } from "./services/operator-extensions.js"
import { OperatorModelRegistry } from "./services/operator-model-registry.js"
import { OperatorRuntime } from "./services/operator-runtime.js"
import { OperatorResources } from "./services/operator-resources.js"
import { OperatorSessionManager } from "./services/operator-session-manager.js"
import { OperatorSessions } from "./services/operator-sessions.js"
import { OperatorSkills } from "./services/operator-skills.js"
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
const OperatorModelRegistryLayer = OperatorModelRegistry.layer
const OperatorSessionsLayer = OperatorSessions.layer.pipe(Layer.provide(DatabaseLayer))
const PluginRegistryLayer = PluginRegistry.layer
const OperatorSkillsLayer = OperatorSkills.layer.pipe(Layer.provide(PluginRegistryLayer))
const OperatorResourcesLayer = OperatorResources.layer.pipe(Layer.provide(PluginRegistryLayer))
const OperatorExtensionsLayer = OperatorExtensions.layer.pipe(Layer.provide(PluginRegistryLayer))
const OperatorSessionManagerLayer = OperatorSessionManager.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      OperatorSessionsLayer,
      OperatorSkillsLayer,
      OperatorResourcesLayer,
      OperatorModelRegistryLayer,
      OperatorExtensionsLayer,
    ),
  ),
)
const OperatorRuntimeLayer = OperatorRuntime.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      DatabaseLayer,
      IngestionLayer,
      AgentRegistryLayer,
      OperatorModelRegistryLayer,
      OperatorSessionsLayer,
      OperatorSessionManagerLayer,
      OperatorExtensionsLayer,
      PluginRegistryLayer,
    ),
  ),
)

// ── AppLayer: merge everything ────────────────────────────────────────────

export const AppLayer = Layer.mergeAll(
  DatabaseLayer,
  BroadcastLayer,
  IngestionLayer,
  RetentionLayer,
  AlertEngineLayer,
  AgentRegistryLayer,
  OperatorModelRegistryLayer,
  OperatorSessionsLayer,
  OperatorSkillsLayer,
  OperatorResourcesLayer,
  OperatorExtensionsLayer,
  OperatorSessionManagerLayer,
  OperatorRuntimeLayer,
  PluginRegistryLayer,
)
