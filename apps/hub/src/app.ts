import { Layer } from "effect"
import { Database } from "./services/database.js"
import { MetricsIngestion } from "./services/metrics-ingestion.js"
import { MetricsBroadcast } from "./services/metrics-broadcast.js"
import { AgentManager } from "./services/agent-manager.js"
import { Retention } from "./services/retention.js"
import { LogService } from "./services/log-service.js"
import { SystemdService } from "./services/systemd-service.js"
import { DockerService } from "./services/docker-service.js"
import { K8sService } from "./services/k8s-service.js"
import { TerminalService } from "./services/terminal.js"
import { AlertEngine } from "./services/alert-engine.js"

// ── Layer 0: Infrastructure (no deps within AppLayer) ───────────────────────

const DatabaseLayer = Database.layer
const BroadcastLayer = MetricsBroadcast.layer

// ── Layer 1: Core services (depend on Database) ───────────────────────────

const IngestionLayer = MetricsIngestion.layer.pipe(Layer.provide(DatabaseLayer))
const AgentManagerLayer = AgentManager.layer.pipe(Layer.provide(DatabaseLayer))
const RetentionLayer = Retention.layer.pipe(Layer.provide(DatabaseLayer))

// ── Layer 2: AlertEngine (depends on Database + MetricsBroadcast) ─────────

const AlertEngineLayer = AlertEngine.layer.pipe(
  Layer.provide(Layer.merge(DatabaseLayer, BroadcastLayer)),
)

// ── Layer 3: Services that depend on AgentManager ────────────────────────

const LogServiceLayer = LogService.layer.pipe(Layer.provide(AgentManagerLayer))
const SystemdServiceLayer = SystemdService.layer.pipe(Layer.provide(AgentManagerLayer))
const DockerServiceLayer = DockerService.layer.pipe(Layer.provide(AgentManagerLayer))
const K8sServiceLayer = K8sService.layer.pipe(Layer.provide(AgentManagerLayer))
const TerminalServiceLayer = TerminalService.layer.pipe(Layer.provide(AgentManagerLayer))

// ── AppLayer: merge everything ────────────────────────────────────────────

export const AppLayer = Layer.mergeAll(
  DatabaseLayer,
  BroadcastLayer,
  IngestionLayer,
  AgentManagerLayer,
  RetentionLayer,
  AlertEngineLayer,
  LogServiceLayer,
  SystemdServiceLayer,
  DockerServiceLayer,
  K8sServiceLayer,
  TerminalServiceLayer,
)
