import { Data } from "effect"

export class AgentNotConnected extends Data.TaggedError("AgentNotConnected")<{
  readonly agentId: string
}> {}

export class SchemaValidationError extends Data.TaggedError("SchemaValidationError")<{
  readonly message: string
  readonly errors: unknown
}> {}

export class RpcCallError extends Data.TaggedError("RpcCallError")<{
  readonly code: string
  readonly message: string
}> {}

export class TimeoutError extends Data.TaggedError("TimeoutError")<{
  readonly method: string
  readonly timeoutMs: number
}> {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string
  readonly cause?: unknown
}> {}
