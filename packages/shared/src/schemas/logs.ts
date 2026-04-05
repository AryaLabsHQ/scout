import { Schema } from "effect"

export const LogSourceSchema = Schema.Literals(["k8s", "systemd"])

/**
 * A batch of log lines from a single `logs.tail` stream subscription.
 * Batched for efficiency on bursty sources (journalctl, kubectl logs -f).
 */
export const LogBatchSchema = Schema.Struct({
  lines: Schema.Array(Schema.String),
  timestamp: Schema.Number,
})

export const LogsTailParamsSchema = Schema.Struct({
  agentId: Schema.String,
  source: LogSourceSchema,
  /** For k8s: pod name. For systemd: unit name. */
  target: Schema.String,
  /** K8s namespace (required when source === "k8s"). */
  namespace: Schema.optionalKey(Schema.String),
  /** K8s container name (optional, for multi-container pods). */
  container: Schema.optionalKey(Schema.String),
  /** Number of historical lines to emit before tailing live. */
  tail: Schema.optionalKey(Schema.Number),
})

export type LogSource = typeof LogSourceSchema.Type
export type LogBatch = typeof LogBatchSchema.Type
export type LogsTailParams = typeof LogsTailParamsSchema.Type
