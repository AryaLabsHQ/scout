import { Schema } from "effect"

export const TerminalModeSchema = Schema.Literals(["shell", "podExec"])

export const TerminalSessionSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  mode: TerminalModeSchema,
  podName: Schema.NullOr(Schema.String),
  namespace: Schema.NullOr(Schema.String),
  cols: Schema.Number,
  rows: Schema.Number,
  createdAt: Schema.Number,
})

export type TerminalSession = typeof TerminalSessionSchema.Type

/**
 * Chunks emitted by the `terminal.open` stream RPC.
 *
 * The first chunk is always a `session-start` carrying the allocated
 * sessionId. Subsequent chunks are `output` containing base64-encoded
 * PTY output from the agent. When the agent's PTY closes, the stream
 * finalizes (no explicit `session-end` needed — stream exit signals it).
 */
export const TerminalOutputSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("session-start"),
    sessionId: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal("output"),
    dataBase64: Schema.String,
  }),
])

export const TerminalOpenParamsSchema = Schema.Struct({
  agentId: Schema.String,
  mode: TerminalModeSchema,
  cols: Schema.Number,
  rows: Schema.Number,
  podName: Schema.optionalKey(Schema.String),
  namespace: Schema.optionalKey(Schema.String),
  container: Schema.optionalKey(Schema.String),
})

export const TerminalInputParamsSchema = Schema.Struct({
  sessionId: Schema.String,
  dataBase64: Schema.String,
})

export const TerminalResizeParamsSchema = Schema.Struct({
  sessionId: Schema.String,
  cols: Schema.Number,
  rows: Schema.Number,
})

export const TerminalCloseParamsSchema = Schema.Struct({
  sessionId: Schema.String,
})

export type TerminalMode = typeof TerminalModeSchema.Type
export type TerminalOutput = typeof TerminalOutputSchema.Type
export type TerminalOpenParams = typeof TerminalOpenParamsSchema.Type
export type TerminalInputParams = typeof TerminalInputParamsSchema.Type
export type TerminalResizeParams = typeof TerminalResizeParamsSchema.Type
export type TerminalCloseParams = typeof TerminalCloseParamsSchema.Type
