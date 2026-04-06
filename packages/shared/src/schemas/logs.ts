import { Schema } from "effect"

/**
 * A batch of log lines from a single plugin log stream subscription.
 * Batched for efficiency on bursty sources.
 */
export const LogBatchSchema = Schema.Struct({
  lines: Schema.Array(Schema.String),
  timestamp: Schema.Number,
})
export type LogBatch = typeof LogBatchSchema.Type
