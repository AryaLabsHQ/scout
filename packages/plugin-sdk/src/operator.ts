import type { Effect } from "effect"
import type { Static, TSchema } from "typebox"

export interface OperatorSessionContext {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly selectedNodeIds: ReadonlyArray<string>
  readonly attachedSkillIds: ReadonlyArray<string>
  readonly approvalMode: string
  readonly planMode: string | undefined
  readonly modelProviderId: string
  readonly modelId: string
}

export interface OperatorPromptHookInput {
  readonly session: OperatorSessionContext
  readonly attachedSkillContents: ReadonlyArray<string>
}

export interface OperatorToolHookInput {
  readonly session: OperatorSessionContext
  readonly toolName: string
  readonly args: unknown
}

export interface OperatorAfterToolHookInput extends OperatorToolHookInput {
  readonly result: unknown
  readonly isError: boolean
}

export interface ScoutOperatorToolExecutionContext {
  readonly session: OperatorSessionContext
  readonly toolCallId: string
  /** Aborted when the operator aborts the call. */
  readonly signal: AbortSignal | undefined
  /** Stream running output to the UI; it becomes the result text when the result omits `text`. */
  readonly output: (chunk: string) => void
}

export interface ScoutOperatorToolResult {
  /** Model-visible result text. */
  readonly text?: string
  /** JSON-serializable data for the UI; not shown to the model. */
  readonly details?: unknown
  readonly isError?: boolean
}

export interface ScoutOperatorResourceDefinition {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly content: string
}

export interface ScoutOperatorSkillDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly content: string
}

export interface ScoutOperatorHookSet {
  readonly beforePrompt?: (
    input: OperatorPromptHookInput,
  ) => Effect.Effect<string | null>
  readonly beforeToolCall?: (
    input: OperatorToolHookInput,
  ) => Effect.Effect<void>
  readonly afterToolCall?: (
    input: OperatorAfterToolHookInput,
  ) => Effect.Effect<void>
}

/**
 * A plugin-contributed operator tool. Tools are treated as mutating unless `requiresConfirmation`
 * is `false`: mutating tools wait for operator approval, are blocked in plan mode, and never rerun
 * after a hub restart interrupts them.
 */
export interface ScoutOperatorTool<TParameters extends TSchema = TSchema> {
  readonly name: string
  readonly label?: string
  readonly description: string
  readonly parameters: TParameters
  readonly requiresConfirmation?: boolean
  readonly execute: (
    params: Static<TParameters>,
    ctx: ScoutOperatorToolExecutionContext,
  ) => Promise<ScoutOperatorToolResult>
}

export interface ScoutOperatorSurface {
  readonly tools?: ReadonlyArray<ScoutOperatorTool<any>>
  readonly resources?: ReadonlyArray<ScoutOperatorResourceDefinition>
  readonly skills?: ReadonlyArray<ScoutOperatorSkillDefinition>
  readonly hooks?: ScoutOperatorHookSet
}

export const defineOperatorTool = <const TParameters extends TSchema>(
  tool: ScoutOperatorTool<TParameters>,
): ScoutOperatorTool<TParameters> => tool

export const defineOperatorResource = <const T extends ScoutOperatorResourceDefinition>(
  resource: T,
): T => resource

export const defineOperatorSkill = <const T extends ScoutOperatorSkillDefinition>(
  skill: T,
): T => skill

export const defineOperator = <const T extends ScoutOperatorSurface>(
  operator: T,
): T => operator
