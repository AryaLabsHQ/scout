import { Schema } from "effect"

export const TerminalModeSchema = Schema.Literal("shell")

export const TerminalSessionSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  mode: TerminalModeSchema,
  cols: Schema.Number,
  rows: Schema.Number,
  createdAt: Schema.Number,
})

export type TerminalSession = typeof TerminalSessionSchema.Type

/**
 * Chunks emitted by terminal stream RPCs.
 *
 * The first chunk is always a `session-start` carrying the allocated
 * sessionId. Subsequent chunks are `output` containing base64-encoded
 * PTY output from the agent. Streams may emit a final `exit` chunk with
 * the process exit code before they finalize.
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
  Schema.Struct({
    _tag: Schema.Literal("exit"),
    exitCode: Schema.NullOr(Schema.Number),
  }),
])

export const TerminalOpenParamsSchema = Schema.Struct({
  agentId: Schema.String,
  mode: TerminalModeSchema,
  cols: Schema.Number,
  rows: Schema.Number,
})

export const TerminalExecParamsSchema = Schema.Struct({
  command: Schema.String,
  cols: Schema.Number,
  rows: Schema.Number,
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
export type TerminalExecParams = typeof TerminalExecParamsSchema.Type
export type TerminalInputParams = typeof TerminalInputParamsSchema.Type
export type TerminalResizeParams = typeof TerminalResizeParamsSchema.Type
export type TerminalCloseParams = typeof TerminalCloseParamsSchema.Type
