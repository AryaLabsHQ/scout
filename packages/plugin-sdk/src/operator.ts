import type { Effect } from "effect"
import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@mariozechner/pi-agent-core"
import type { Static, TSchema } from "@sinclair/typebox"

export interface OperatorSessionContext {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly selectedNodeIds: ReadonlyArray<string>
  readonly attachedSkillIds: ReadonlyArray<string>
  readonly approvalMode: string
  readonly bypassMode: string
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

export interface ScoutOperatorTool<
  TParameters extends TSchema = TSchema,
  TDetails = unknown,
> extends Omit<AgentTool<TParameters, TDetails>, "execute"> {
  readonly requiresConfirmation?: boolean
  readonly execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ScoutOperatorToolExecutionContext,
  ) => Promise<AgentToolResult<TDetails>>
}

export interface ScoutOperatorSurface {
  readonly tools?: ReadonlyArray<ScoutOperatorTool<any, any>>
  readonly resources?: ReadonlyArray<ScoutOperatorResourceDefinition>
  readonly skills?: ReadonlyArray<ScoutOperatorSkillDefinition>
  readonly hooks?: ScoutOperatorHookSet
}

export const defineOperatorTool = <
  const TParameters extends TSchema,
  TDetails = unknown,
>(
  tool: ScoutOperatorTool<TParameters, TDetails>,
): ScoutOperatorTool<TParameters, TDetails> => tool

export const defineOperatorResource = <const T extends ScoutOperatorResourceDefinition>(
  resource: T,
): T => resource

export const defineOperatorSkill = <const T extends ScoutOperatorSkillDefinition>(
  skill: T,
): T => skill

export const defineOperator = <const T extends ScoutOperatorSurface>(
  operator: T,
): T => operator
