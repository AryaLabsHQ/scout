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
