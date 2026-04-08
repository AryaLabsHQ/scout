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

CREATE TABLE IF NOT EXISTS operator_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  selected_node_ids TEXT NOT NULL DEFAULT '[]',
  attached_skill_ids TEXT NOT NULL DEFAULT '[]',
  approval_mode TEXT NOT NULL,
  bypass_mode TEXT NOT NULL,
  bypass_expires_at INTEGER,
  summary TEXT,
  model_provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  parent_session_id TEXT,
  forked_from_entry_id TEXT,
  current_leaf_entry_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_event_seq INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_updated_at
  ON operator_sessions (updated_at);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_status
  ON operator_sessions (status);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_parent_session
  ON operator_sessions (parent_session_id);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_current_leaf
  ON operator_sessions (current_leaf_entry_id);

CREATE TABLE IF NOT EXISTS operator_session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES operator_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  at INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operator_session_events_session_seq
  ON operator_session_events (session_id, seq);

CREATE INDEX IF NOT EXISTS idx_operator_session_events_session_at
  ON operator_session_events (session_id, at);

CREATE TABLE IF NOT EXISTS operator_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES operator_sessions(id) ON DELETE CASCADE,
  parent_entry_id TEXT,
  source_event_id TEXT,
  kind TEXT NOT NULL,
  role TEXT,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operator_entries_session_created
  ON operator_entries (session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_operator_entries_session_parent
  ON operator_entries (session_id, parent_entry_id);

CREATE INDEX IF NOT EXISTS idx_operator_entries_session_kind
  ON operator_entries (session_id, kind);

CREATE TABLE IF NOT EXISTS operator_tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES operator_sessions(id) ON DELETE CASCADE,
  entry_id TEXT,
  node_ids TEXT NOT NULL DEFAULT '[]',
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  input TEXT,
  output TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_operator_tool_calls_session_started
  ON operator_tool_calls (session_id, started_at);

CREATE INDEX IF NOT EXISTS idx_operator_tool_calls_session_status
  ON operator_tool_calls (session_id, status);

CREATE INDEX IF NOT EXISTS idx_operator_tool_calls_session_name
  ON operator_tool_calls (session_id, name);

CREATE TABLE IF NOT EXISTS operator_approvals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES operator_sessions(id) ON DELETE CASCADE,
  entry_id TEXT,
  tool_call_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  affected_node_ids TEXT NOT NULL DEFAULT '[]',
  requested_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_operator_approvals_session_status
  ON operator_approvals (session_id, status);

CREATE INDEX IF NOT EXISTS idx_operator_approvals_session_requested
  ON operator_approvals (session_id, requested_at);

CREATE INDEX IF NOT EXISTS idx_operator_approvals_tool_call
  ON operator_approvals (tool_call_id);

CREATE TABLE IF NOT EXISTS operator_terminal_projections (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES operator_sessions(id) ON DELETE CASCADE,
  tool_call_id TEXT NOT NULL,
  entry_id TEXT,
  node_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  stream_ref TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operator_terminal_projections_session_tool_call
  ON operator_terminal_projections (session_id, tool_call_id);

CREATE INDEX IF NOT EXISTS idx_operator_terminal_projections_session_created
  ON operator_terminal_projections (session_id, created_at);

CREATE TABLE IF NOT EXISTS operator_plan_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES operator_sessions(id) ON DELETE CASCADE,
  entry_id TEXT,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operator_plan_snapshots_session_updated
  ON operator_plan_snapshots (session_id, updated_at);
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
