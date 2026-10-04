import { Effect, Layer } from "effect"
import { Database } from "../../src/services/database.js"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { Database as BunDatabase } from "bun:sqlite"
import * as schema from "../../drizzle/schema.js"

const CREATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS systems (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL,
  tailscale_ip TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  capabilities TEXT NOT NULL DEFAULT '{}',
  plugin_capabilities TEXT NOT NULL DEFAULT '[]',
  last_seen INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS system_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_id TEXT NOT NULL REFERENCES systems(id),
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT '1m',
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metrics_system_time_type
  ON system_metrics (system_id, timestamp, type);

CREATE TABLE IF NOT EXISTS plugin_entities (
  key TEXT PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  plugin_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  display_name TEXT,
  status TEXT,
  labels TEXT,
  spec TEXT,
  state TEXT,
  relationships TEXT
);

CREATE INDEX IF NOT EXISTS idx_plugin_entities_system_plugin_kind
  ON plugin_entities (system_id, plugin_id, kind);

CREATE INDEX IF NOT EXISTS idx_plugin_entities_system_plugin_observed
  ON plugin_entities (system_id, plugin_id, observed_at);

CREATE TABLE IF NOT EXISTS plugin_metric_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_id TEXT NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  plugin_id TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  entity_kind TEXT,
  entity_id TEXT,
  value REAL NOT NULL,
  unit TEXT,
  tags TEXT
);

CREATE INDEX IF NOT EXISTS idx_plugin_metric_points_system_plugin_metric_time
  ON plugin_metric_points (system_id, plugin_id, metric_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_plugin_metric_points_system_plugin_entity_time
  ON plugin_metric_points (system_id, plugin_id, entity_kind, entity_id, timestamp);

CREATE TABLE IF NOT EXISTS plugin_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_id TEXT NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  plugin_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  entity_kind TEXT,
  entity_id TEXT,
  severity TEXT NOT NULL,
  message TEXT,
  payload TEXT
);

CREATE INDEX IF NOT EXISTS idx_plugin_events_system_plugin_time
  ON plugin_events (system_id, plugin_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_plugin_events_system_plugin_event_time
  ON plugin_events (system_id, plugin_id, event_id, timestamp);

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  metric TEXT NOT NULL,
  operator TEXT NOT NULL,
  threshold REAL NOT NULL,
  consecutive_count INTEGER NOT NULL DEFAULT 3,
  severity TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES alert_rules(id),
  system_id TEXT NOT NULL REFERENCES systems(id),
  state TEXT NOT NULL DEFAULT 'active',
  severity TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  triggered_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_alerts_system_state
  ON alerts (system_id, state);
`

/**
 * In-memory SQLite Database layer for integration tests.
 * Creates a fresh database with the full schema on each test run.
 */
export const TestDatabaseLayer: Layer.Layer<Database> = Layer.effect(
  Database,
  Effect.acquireRelease(
    Effect.sync(() => {
      const sqlite = new BunDatabase(":memory:")
      sqlite.exec("PRAGMA foreign_keys=ON")
      sqlite.exec(CREATE_SCHEMA_SQL)
      return drizzle({ client: sqlite, schema })
    }),
    (db) => Effect.sync(() => db.$client.close()),
  ),
)
