import { Effect, Option, Stream } from "effect"
import type { Context as ChordContext, JsonValue } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import type { ToolCall } from "@earendil-works/pi-ai"
import {
  defineExtension,
  defineTool,
  type Extension,
  hook,
  type HookApi,
  section,
  ToolTask,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolRegistration,
} from "@earendil-works/pi-durable"
import { Terminal as HeadlessTerminal } from "@xterm/headless"
import type { LogBatch, TerminalOutput } from "@scout/shared"
import type {
  ActionDefinition,
  OperatorSessionContext,
  PluginManifest,
  ScoutOperatorTool,
  StreamDefinition,
} from "@scout/plugin-sdk"
import * as schema from "../../drizzle/schema.js"
import type { HubAgentClient } from "../rpc/agent-bridge.js"
import type { ScoutDatabase } from "./database.js"
import type { MetricsIngestion } from "./metrics-ingestion.js"
import type { OperatorExtensions } from "./operator-extensions.js"
import {
  OperatorApprovalsDoc,
  type OperatorApprovalRecord,
  type OperatorSessionMeta,
  OperatorSessionsDoc,
} from "./operator-docs.js"
import type { OperatorSkills } from "./operator-skills.js"
import type { LoadedOperatorPlugin } from "./plugin-registry.js"

// ── Names and policies ───────────────────────────────────────────────────────

export const OperatorToolNames = {
  observeSystems: "observe_systems",
  observeAlerts: "observe_alerts",
  observeMetrics: "observe_metrics",
  observePlugins: "observe_plugins",
  pluginRunAction: "plugin_run_action",
  pluginLogs: "plugin_logs",
  bashRun: "bash_run",
  askUser: "ask_user",
} as const

export type PluginInventoryManifest = Pick<
  PluginManifest,
  "id" | "displayName" | "actions" | "streams" | "metrics" | "entityKinds"
>

export type PluginOperatorToolPolicy = {
  readonly requiresConfirmation: boolean
}

const findPluginActionDefinition = (
  manifests: ReadonlyMap<string, PluginInventoryManifest>,
  pluginId: string,
  actionId: string,
): ActionDefinition | null =>
  manifests.get(pluginId)?.actions.find((action) => action.id === actionId) ?? null

const findPluginStreamDefinition = (
  manifests: ReadonlyMap<string, PluginInventoryManifest>,
  pluginId: string,
  streamId: string,
): StreamDefinition | null =>
  manifests.get(pluginId)?.streams.find((stream) => stream.id === streamId) ?? null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Whether a call changes system state: mutating bash, plugin actions that declare
 * `requiresConfirmation`, and plugin operator tools unless they opt out.
 */
export const isMutatingCall = (
  toolName: string,
  args: unknown,
  manifests: ReadonlyMap<string, PluginInventoryManifest>,
  pluginOperatorTools: ReadonlyMap<string, PluginOperatorToolPolicy>,
): { readonly mutating: boolean; readonly reason: string } => {
  if (toolName === OperatorToolNames.bashRun && isRecord(args) && args.isMutation === true) {
    return {
      mutating: true,
      reason: typeof args.label === "string" ? args.label : "Mutation requested by operator",
    }
  }
  if (
    toolName === OperatorToolNames.pluginRunAction &&
    isRecord(args) &&
    typeof args.pluginId === "string" &&
    typeof args.actionId === "string"
  ) {
    const action = findPluginActionDefinition(manifests, args.pluginId, args.actionId)
    if (action?.requiresConfirmation === true) {
      return { mutating: true, reason: `Plugin action ${args.pluginId}.${args.actionId} requires approval` }
    }
  }
  if (pluginOperatorTools.get(toolName)?.requiresConfirmation === true) {
    return { mutating: true, reason: `Operator tool ${toolName} requires approval` }
  }
  return { mutating: false, reason: "" }
}

/** Whether a call must wait for an operator decision under the session's approval mode. */
export const requiresOperatorApproval = (
  toolName: string,
  args: unknown,
  manifests: ReadonlyMap<string, PluginInventoryManifest>,
  pluginOperatorTools: ReadonlyMap<string, PluginOperatorToolPolicy>,
  approvalMode: OperatorSessionMeta["approvalMode"],
): { readonly required: boolean; readonly reason: string | null } => {
  if (approvalMode === "auto_approve_all") return { required: false, reason: null }
  const { mutating, reason } = isMutatingCall(toolName, args, manifests, pluginOperatorTools)
  return mutating ? { required: true, reason } : { required: false, reason: null }
}

/** Plan mode blocks every plugin action, not only confirmed ones, plus every other mutating call. */
const isPlanModeBlocked = (
  toolName: string,
  args: unknown,
  manifests: ReadonlyMap<string, PluginInventoryManifest>,
  pluginOperatorTools: ReadonlyMap<string, PluginOperatorToolPolicy>,
): boolean =>
  toolName === OperatorToolNames.pluginRunAction ||
  isMutatingCall(toolName, args, manifests, pluginOperatorTools).mutating

// ── Formatting helpers ───────────────────────────────────────────────────────

const formatSystemsSnapshot = (rows: ReadonlyArray<typeof schema.systems.$inferSelect>): string => {
  if (rows.length === 0) return "No systems are in the current session scope."
  return rows
    .map((row) => {
      const pluginCapabilities = (row.pluginCapabilities as Array<{ pluginId: string }> | null) ?? []
      return [
        `${row.id} (${row.hostname})`,
        `status=${row.status}`,
        `lastSeen=${row.lastSeen?.toISOString() ?? "unknown"}`,
        `plugins=${pluginCapabilities.map((capability) => capability.pluginId).join(",") || "none"}`,
      ].join(" ")
    })
    .join("\n")
}

const formatAlertsSnapshot = (rows: ReadonlyArray<typeof schema.alerts.$inferSelect>): string => {
  if (rows.length === 0) return "No active alerts are currently in scope."
  return rows
    .map(
      (row) =>
        `${row.systemId} ${row.severity.toUpperCase()} ${row.metric}=${row.value} state=${row.state} triggeredAt=${row.triggeredAt.toISOString()}`,
    )
    .join("\n")
}

const formatPercent = (value: number | null | undefined): string =>
  value === null || value === undefined ? "n/a" : `${value.toFixed(1)}%`

const formatBytes = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "n/a"
  if (value < 1024) return `${value} B`
  const units = ["KB", "MB", "GB", "TB"]
  let current = value / 1024
  let unitIndex = 0
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024
    unitIndex += 1
  }
  return `${current.toFixed(1)} ${units[unitIndex]}`
}

export const formatMetricsSnapshot = (
  rows: ReadonlyArray<{
    readonly systemId: string
    readonly sample: {
      readonly cpuPercent: number
      readonly memoryPercent: number
      readonly memoryUsedBytes: number
      readonly memoryTotalBytes: number
      readonly loadAvg1m: number
      readonly diskPercent: number | null
      readonly diskUsedBytes: number | null
      readonly diskTotalBytes: number | null
      readonly networkRxBytesPerSec: number
      readonly networkTxBytesPerSec: number
      readonly gpuPercent: number | null
      readonly uptimeSeconds: number
    }
  }>,
): string => {
  if (rows.length === 0) return "No recent host metrics are available in the current session scope."
  return rows
    .map(({ systemId, sample }) =>
      [
        `${systemId}`,
        `cpu=${formatPercent(sample.cpuPercent)}`,
        `mem=${formatPercent(sample.memoryPercent)} (${formatBytes(sample.memoryUsedBytes)}/${formatBytes(sample.memoryTotalBytes)})`,
        `load1=${sample.loadAvg1m.toFixed(2)}`,
        `disk=${formatPercent(sample.diskPercent)} (${formatBytes(sample.diskUsedBytes)}/${formatBytes(sample.diskTotalBytes)})`,
        `net=${formatBytes(sample.networkRxBytesPerSec)}/s in ${formatBytes(sample.networkTxBytesPerSec)}/s out`,
        `gpu=${formatPercent(sample.gpuPercent)}`,
        `uptime=${Math.floor(sample.uptimeSeconds / 3600)}h`,
      ].join(" "),
    )
    .join("\n")
}

export const formatPluginInventory = (
  rows: ReadonlyArray<{
    readonly systemId: string
    readonly pluginId: string
    readonly displayName: string
    readonly actions: ReadonlyArray<ActionDefinition>
    readonly streams: ReadonlyArray<StreamDefinition>
    readonly entityCount: number
    readonly recentMetricCount: number
    readonly recentEventCount: number
  }>,
): string => {
  if (rows.length === 0) {
    return "No plugin capabilities are currently available in the selected session scope."
  }
  return rows
    .map((row) =>
      [
        `${row.systemId} ${row.pluginId} (${row.displayName})`,
        `actions=${row.actions.map((action) => action.id).join(",") || "none"}`,
        `streams=${row.streams.map((stream) => stream.id).join(",") || "none"}`,
        `entities=${row.entityCount}`,
        `recentMetrics=${row.recentMetricCount}`,
        `recentEvents=${row.recentEventCount}`,
      ].join(" "),
    )
    .join("\n")
}

const writeHeadlessChunk = (term: HeadlessTerminal, bytes: Uint8Array): Promise<void> =>
  new Promise((resolve) => {
    term.write(bytes, resolve)
  })

export const extractTerminalText = async (params: {
  readonly base64Chunks: ReadonlyArray<string>
  readonly cols: number
  readonly rows: number
}): Promise<string> => {
  const term = new HeadlessTerminal({
    cols: params.cols,
    rows: params.rows,
    scrollback: 10_000,
    convertEol: true,
    allowProposedApi: true,
  })
  for (const chunk of params.base64Chunks) {
    await writeHeadlessChunk(term, Buffer.from(chunk, "base64"))
  }
  const lines: Array<string> = []
  for (let index = 0; index < term.buffer.active.length; index += 1) {
    const line = term.buffer.active.getLine(index)
    if (line === undefined) continue
    const text = line.translateToString(true)
    if (line.isWrapped && lines.length > 0) {
      lines[lines.length - 1] += text
      continue
    }
    lines.push(text)
  }
  term.dispose()
  return lines.join("\n").trimEnd()
}

// ── Tool plumbing ────────────────────────────────────────────────────────────

const DEFAULT_PLUGIN_LOG_BATCHES = 4
const MAX_PLUGIN_LOG_BATCHES = 10
const MAX_PLUGIN_LOG_LINES = 200
const BASH_RUN_COLS = 120
const BASH_RUN_ROWS = 40
const BASH_RUN_TIMEOUT = "30 seconds"
/** Raw PTY output kept for the terminal mirror; the model sees the rendered text either way. */
const MAX_TERMINAL_MIRROR_BASE64 = 1_000_000

/** Strict JSON for results and details: drops undefined, turns Dates into ISO strings. */
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value ?? null)) as JsonValue

const textResult = (text: string, details?: unknown): ToolExecutionResult => ({
  content: [{ type: "text", text }],
  ...(details === undefined ? {} : { details: json(details) }),
})

const errorResult = (text: string): ToolExecutionResult => ({
  content: [{ type: "text", text }],
  isError: true,
})

/** Runs an Effect under the tool call's cancellation. */
const run = <A, E>(effect: Effect.Effect<A, E>, context: ChordContext): Promise<A> =>
  Effect.runPromise(effect, context.abortSignal === undefined ? undefined : { signal: context.abortSignal })

/** The Scout session of a conversation; every operator conversation has one. */
export const readSessionMeta = async (
  api: Pick<HookApi, "snapshot" | "conversationId">,
  context: ChordContext,
): Promise<OperatorSessionMeta> => {
  const meta = (await api.snapshot(OperatorSessionsDoc, context))?.sessions[String(api.conversationId)]
  if (meta === undefined) throw new Error(`Operator session ${api.conversationId} has no Scout metadata`)
  return meta
}

const requireScopedNode = (meta: OperatorSessionMeta, nodeId: string): void => {
  if (!meta.selectedNodeIds.includes(nodeId)) {
    throw new Error(`Node ${nodeId} is outside the session scope (${meta.selectedNodeIds.join(", ")})`)
  }
}

const scopedNodeIds = (meta: OperatorSessionMeta, requested: ReadonlyArray<string> | undefined) => {
  const nodeIds = requested ?? meta.selectedNodeIds
  for (const nodeId of nodeIds) requireScopedNode(meta, nodeId)
  return nodeIds
}

export const toolNodeIds = (args: unknown, sessionNodeIds: ReadonlyArray<string>): Array<string> => {
  if (!isRecord(args)) return [...sessionNodeIds]
  if (typeof args.nodeId === "string") return [args.nodeId]
  if (Array.isArray(args.nodeIds) && args.nodeIds.length > 0) {
    return args.nodeIds.filter((value): value is string => typeof value === "string")
  }
  return [...sessionNodeIds]
}

const parseJsonInput = (inputJson: string | undefined): unknown =>
  inputJson === undefined || inputJson.trim().length === 0 ? undefined : JSON.parse(inputJson)

const resolvePluginEntity = (
  pluginId: string,
  entityKind: string | undefined,
  entityId: string | undefined,
) => {
  if (entityKind === undefined && entityId === undefined) return undefined
  if (entityKind === undefined || entityId === undefined) {
    throw new Error("Both entityKind and entityId are required when targeting a plugin entity")
  }
  return { pluginId, kind: entityKind, id: entityId }
}

const clampPluginLogBatches = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value)
    ? DEFAULT_PLUGIN_LOG_BATCHES
    : Math.min(MAX_PLUGIN_LOG_BATCHES, Math.max(1, Math.floor(value)))

// ── Durable approvals ────────────────────────────────────────────────────────

type ApprovalRequest =
  | { readonly kind: "mutation"; readonly reason: string; readonly affectedNodeIds: ReadonlyArray<string> }
  | {
      readonly kind: "clarification"
      readonly question: NonNullable<OperatorApprovalRecord["question"]>
    }

const plainRecord = (record: Readonly<OperatorApprovalRecord>): OperatorApprovalRecord =>
  JSON.parse(JSON.stringify(record)) as OperatorApprovalRecord

/**
 * Record an approval request for this call, keyed by its tool task id, then wait for a decision.
 *
 * The record and the wait are both durable: approval tools are `replay: "safe"`, so after a hub
 * restart the call reruns, finds its existing record, and either resumes waiting or proceeds with
 * the stored decision. Nothing executes before the decision is committed.
 */
const awaitDecision = async (
  api: ToolExecutionApi,
  call: { readonly name: string },
  request: ApprovalRequest,
  context: ChordContext,
): Promise<OperatorApprovalRecord> => {
  const id = String(api.taskId)
  const recorded = await api.commit(async (tx) => {
    const doc = await tx.doc(OperatorApprovalsDoc, api.conversationId)
    const existing = doc.requests[id]
    if (existing !== undefined) return plainRecord(existing)
    const created: OperatorApprovalRecord = {
      id,
      toolCallId: api.callId,
      toolName: call.name,
      kind: request.kind,
      status: "pending",
      reason: request.kind === "mutation" ? request.reason : request.question.question,
      affectedNodeIds: request.kind === "mutation" ? [...request.affectedNodeIds] : [],
      requestedAt: Date.now(),
      ...(request.kind === "clarification" ? { question: request.question } : {}),
    }
    doc.requests[id] = created
    return created
  }, context)
  if (recorded.status !== "pending") return recorded

  const watch = await api.watchDoc(OperatorApprovalsDoc, api.conversationId, context)
  if (watch === undefined) throw new Error("Operator approvals document is missing")
  try {
    const decided = (value: Readonly<{ requests: Record<string, OperatorApprovalRecord> }> | null) => {
      const record = value?.requests[id]
      return record !== undefined && record.status !== "pending" ? plainRecord(record) : undefined
    }
    const current = decided(watch.value)
    if (current !== undefined) return current
    return await new Promise<OperatorApprovalRecord>((resolve, reject) => {
      // Abort (operator stop) and Harness close both end the wait; on close the call stays durable
      // and reruns into this wait after reopen.
      const signal = context.abortSignal
      if (signal?.aborted) return reject(signal.reason)
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
      watch.start(async (value) => {
        const record = decided(value)
        if (record !== undefined) resolve(record)
      })
      void watch.closed.then((end) => reject(new Error(`Approval wait ended: ${end.reason}`)))
    })
  } finally {
    await watch.stop()
  }
}

/**
 * Claim the single execution of this call's side effect. A rerun after a restart that interrupted
 * a claimed execution must not run it again: it cannot know how far the first attempt got.
 */
const claimExecution = async (api: ToolExecutionApi, context: ChordContext): Promise<boolean> => {
  const token = crypto.randomUUID()
  return (await api.memo<string>("scout.execution", token, context)) === token
}

const INTERRUPTED_TEXT =
  "This call was interrupted by a hub restart after it started executing and may have partially run. " +
  "It was not executed again. Inspect the current system state before deciding whether to retry."

const rejectedText = (record: OperatorApprovalRecord): string =>
  `The operator rejected this action${record.actor ? ` (${record.actor})` : ""}. ` +
  "Do not retry it unless the user asks; explain what you intended instead."

// ── Extensions ───────────────────────────────────────────────────────────────

export interface OperatorToolDependencies {
  readonly db: ScoutDatabase
  readonly ingestion: typeof MetricsIngestion.Service
  readonly agents: { readonly getClient: (agentId: string) => Effect.Effect<HubAgentClient | null> }
  readonly manifests: ReadonlyMap<string, PluginInventoryManifest>
  readonly operatorPlugins: ReadonlyArray<LoadedOperatorPlugin>
  readonly extensions: typeof OperatorExtensions.Service
  readonly skills: typeof OperatorSkills.Service
  readonly systemPrompt: string
}

export interface OperatorExtensionSet {
  /** Tools, prompt sections, and plugin hooks; selected by every conversation. */
  readonly scout: Extension
  /** Plan mode: selected per conversation; blocks mutating calls. */
  readonly plan: Extension
  readonly pluginOperatorTools: ReadonlyMap<string, PluginOperatorToolPolicy>
}

const toPluginSessionContext = (id: string, meta: OperatorSessionMeta): OperatorSessionContext => ({
  id,
  title: meta.title,
  status: meta.archived ? "archived" : "active",
  selectedNodeIds: meta.selectedNodeIds,
  attachedSkillIds: meta.attachedSkillIds,
  approvalMode: meta.approvalMode,
  planMode: meta.planMode,
  modelProviderId: meta.modelProviderId,
  modelId: meta.modelId,
})

const getConnectedClient = async (
  deps: OperatorToolDependencies,
  nodeId: string,
  context: ChordContext,
): Promise<HubAgentClient> => {
  const client = await run(deps.agents.getClient(nodeId), context)
  if (client === null) throw new Error(`Node ${nodeId} is not currently connected`)
  return client
}

const scopedNodeIdsSchema = Type.Object({
  nodeIds: Type.Optional(
    Type.Array(Type.String({ description: "Optional subset of scoped node ids to inspect" })),
  ),
})

const pluginInventorySchema = Type.Object({
  nodeIds: Type.Optional(
    Type.Array(Type.String({ description: "Optional subset of scoped node ids to inspect" })),
  ),
  pluginId: Type.Optional(Type.String({ description: "Optional plugin id to narrow discovery" })),
})

const pluginActionSchema = Type.Object({
  nodeId: Type.String({ description: "Target node id from the current session scope" }),
  pluginId: Type.String({ description: "Plugin id to target on the selected node" }),
  actionId: Type.String({ description: `Plugin action id from ${OperatorToolNames.observePlugins}` }),
  entityKind: Type.Optional(
    Type.String({ description: "Optional plugin entity kind when targeting an entity action" }),
  ),
  entityId: Type.Optional(
    Type.String({ description: "Optional plugin entity id when targeting an entity action" }),
  ),
  inputJson: Type.Optional(
    Type.String({
      description:
        "Optional JSON-encoded action input object. Omit it when the action does not require input.",
    }),
  ),
})

const pluginLogsSchema = Type.Object({
  nodeId: Type.String({ description: "Target node id from the current session scope" }),
  pluginId: Type.String({ description: "Plugin id to target on the selected node" }),
  streamId: Type.String({ description: `Plugin log stream id from ${OperatorToolNames.observePlugins}` }),
  entityKind: Type.Optional(
    Type.String({ description: "Optional plugin entity kind when targeting an entity log stream" }),
  ),
  entityId: Type.Optional(
    Type.String({ description: "Optional plugin entity id when targeting an entity log stream" }),
  ),
  inputJson: Type.Optional(
    Type.String({
      description:
        "Optional JSON-encoded stream input object. Omit it when the stream does not require input.",
    }),
  ),
  maxBatches: Type.Optional(
    Type.Number({
      description: `Maximum number of log batches to read before returning (default ${DEFAULT_PLUGIN_LOG_BATCHES}, max ${MAX_PLUGIN_LOG_BATCHES}).`,
    }),
  ),
})

const bashRunSchema = Type.Object({
  nodeId: Type.String({ description: "Target node id from the current session scope" }),
  label: Type.String({ description: "Short description of why this command is being run" }),
  command: Type.String({ description: "Shell command to execute on the selected node" }),
  isMutation: Type.Boolean({
    description: "True only when the command changes system state; false for read-only diagnostics",
  }),
})

const askUserSchema = Type.Object({
  question: Type.String({ description: "The complete question to ask" }),
  header: Type.String({ description: "Short label (max 30 chars)" }),
  options: Type.Array(
    Type.Object({
      label: Type.String({ description: "Choice label (1-5 words)" }),
      description: Type.String({ description: "What this choice means" }),
    }),
  ),
  multiple: Type.Optional(Type.Boolean({ description: "Allow multiple selections" })),
})

export const makeOperatorExtensions = (deps: OperatorToolDependencies): OperatorExtensionSet => {
  const pluginOperatorTools = new Map<string, PluginOperatorToolPolicy>(
    deps.operatorPlugins.flatMap((plugin) =>
      (plugin.operator.tools ?? []).map(
        (tool) => [tool.name, { requiresConfirmation: tool.requiresConfirmation !== false }] as const,
      ),
    ),
  )

  /**
   * Gate a side-effecting call: wait for approval when the session requires it, then claim the
   * single execution. Returns the result to report instead of executing, or undefined to proceed.
   */
  const gate = async (
    api: ToolExecutionApi,
    name: string,
    args: unknown,
    meta: OperatorSessionMeta,
    context: ChordContext,
  ): Promise<ToolExecutionResult | undefined> => {
    const approval = requiresOperatorApproval(
      name,
      args,
      deps.manifests,
      pluginOperatorTools,
      meta.approvalMode,
    )
    if (approval.required) {
      const record = await awaitDecision(
        api,
        { name },
        {
          kind: "mutation",
          reason: approval.reason ?? "Approval required",
          affectedNodeIds: toolNodeIds(args, meta.selectedNodeIds),
        },
        context,
      )
      if (record.status === "rejected") return errorResult(rejectedText(record))
      if (record.status !== "approved") return errorResult(`The approval request was ${record.status}.`)
    }
    if (!(await claimExecution(api, context))) return errorResult(INTERRUPTED_TEXT)
    return undefined
  }

  const observeSystems = defineTool({
    name: OperatorToolNames.observeSystems,
    description: "List scoped systems with current status and plugin capability summary.",
    parameters: scopedNodeIdsSchema,
    replay: "safe",
    execute: async (args, api, context) => {
      const nodeIds = scopedNodeIds(await readSessionMeta(api, context), args.nodeIds)
      const rows = deps.db
        .select()
        .from(schema.systems)
        .all()
        .filter((row) => nodeIds.includes(row.id))
      return textResult(formatSystemsSnapshot(rows), { nodeIds, systems: rows })
    },
  })

  const observeAlerts = defineTool({
    name: OperatorToolNames.observeAlerts,
    description: "List active or acknowledged alerts within the current session scope.",
    parameters: scopedNodeIdsSchema,
    replay: "safe",
    execute: async (args, api, context) => {
      const nodeIds = scopedNodeIds(await readSessionMeta(api, context), args.nodeIds)
      const rows = deps.db
        .select()
        .from(schema.alerts)
        .all()
        .filter(
          (row) => nodeIds.includes(row.systemId) && (row.state === "active" || row.state === "acknowledged"),
        )
      return textResult(formatAlertsSnapshot(rows), { nodeIds, alerts: rows })
    },
  })

  const observeMetrics = defineTool({
    name: OperatorToolNames.observeMetrics,
    description:
      "Inspect the latest host metrics for scoped nodes, including CPU, memory, disk, network, and uptime.",
    parameters: scopedNodeIdsSchema,
    replay: "safe",
    execute: async (args, api, context) => {
      const nodeIds = scopedNodeIds(await readSessionMeta(api, context), args.nodeIds)
      const samples = await Promise.all(
        nodeIds.map(async (systemId) => ({
          systemId,
          sample: await run(deps.ingestion.queryLatest(systemId), context),
        })),
      )
      const metricRows = samples.flatMap((row) =>
        row.sample === null ? [] : [{ ...row, sample: row.sample }],
      )
      const missingNodeIds = nodeIds.filter((nodeId) => !metricRows.some((row) => row.systemId === nodeId))
      const text = [
        formatMetricsSnapshot(metricRows),
        ...(missingNodeIds.length > 0
          ? [`No recent host metrics found for: ${missingNodeIds.join(", ")}`]
          : []),
      ].join("\n")
      return textResult(text, { nodeIds, metrics: metricRows, missingNodeIds })
    },
  })

  const observePlugins = defineTool({
    name: OperatorToolNames.observePlugins,
    description:
      "Discover plugin capabilities in the current session scope, including actions, streams, entity counts, and recent activity.",
    parameters: pluginInventorySchema,
    replay: "safe",
    execute: async (args, api, context) => {
      const nodeIds = scopedNodeIds(await readSessionMeta(api, context), args.nodeIds)
      const systems = deps.db
        .select()
        .from(schema.systems)
        .all()
        .filter((row) => nodeIds.includes(row.id))
      const plugins = await Promise.all(
        systems.flatMap((row) => {
          const capabilities =
            (row.pluginCapabilities as Array<{
              pluginId: string
              status?: string
              features?: ReadonlyArray<string>
            }> | null) ?? []
          return capabilities
            .filter((capability) => args.pluginId === undefined || capability.pluginId === args.pluginId)
            .map(async (capability) => {
              const manifest = deps.manifests.get(capability.pluginId)
              const count = async (effect: Effect.Effect<ReadonlyArray<unknown>>) =>
                manifest === undefined ? 0 : (await run(effect, context)).length
              return {
                systemId: row.id,
                pluginId: capability.pluginId,
                displayName: manifest?.displayName ?? capability.pluginId,
                status: capability.status ?? "unknown",
                features: [...(capability.features ?? [])],
                actions: manifest?.actions ?? [],
                streams: manifest?.streams ?? [],
                metrics: manifest?.metrics ?? [],
                entityKinds: manifest?.entityKinds ?? [],
                entityCount: await count(deps.ingestion.queryPluginEntities(row.id, capability.pluginId)),
                recentMetricCount: await count(
                  deps.ingestion.queryPluginMetricPoints(row.id, capability.pluginId, 24),
                ),
                recentEventCount: await count(
                  deps.ingestion.queryPluginEvents(row.id, capability.pluginId, 24),
                ),
              }
            })
        }),
      )
      return textResult(formatPluginInventory(plugins), { nodeIds, plugins })
    },
  })

  const pluginRunAction = defineTool({
    name: OperatorToolNames.pluginRunAction,
    description:
      "Execute a plugin action on one scoped node using the Scout hub-to-agent plugin management RPC.",
    parameters: pluginActionSchema,
    // Reruns after a restart only to resume an approval wait; `gate` never executes twice.
    replay: "safe",
    execute: async (args, api, context) => {
      const meta = await readSessionMeta(api, context)
      requireScopedNode(meta, args.nodeId)
      const action = findPluginActionDefinition(deps.manifests, args.pluginId, args.actionId)
      if (action === null) throw new Error(`Plugin action ${args.pluginId}.${args.actionId} is not available`)
      const entity = resolvePluginEntity(args.pluginId, args.entityKind, args.entityId)
      const input = parseJsonInput(args.inputJson)
      const gated = await gate(api, OperatorToolNames.pluginRunAction, args, meta, context)
      if (gated !== undefined) return gated
      const client = await getConnectedClient(deps, args.nodeId, context)
      const result = await run(
        client["plugins.runAction"]({
          pluginId: args.pluginId,
          actionId: args.actionId,
          ...(entity !== undefined ? { entity } : {}),
          ...(input !== undefined ? { input } : {}),
        }).pipe(Effect.mapError((error) => new Error(error.message))),
        context,
      )
      const summary =
        result.summary ??
        (result.success
          ? `Plugin action ${args.pluginId}.${args.actionId} completed successfully`
          : `Plugin action ${args.pluginId}.${args.actionId} reported failure`)
      return textResult(summary, {
        nodeId: args.nodeId,
        pluginId: args.pluginId,
        actionId: args.actionId,
        action,
        entity,
        input,
        result,
      })
    },
  })

  const pluginLogs = defineTool({
    name: OperatorToolNames.pluginLogs,
    description:
      "Read a bounded slice of plugin log output from one scoped node without opening a long-lived tail.",
    parameters: pluginLogsSchema,
    replay: "safe",
    execute: async (args, api, context) => {
      requireScopedNode(await readSessionMeta(api, context), args.nodeId)
      const streamDefinition = findPluginStreamDefinition(deps.manifests, args.pluginId, args.streamId)
      if (streamDefinition === null)
        throw new Error(`Plugin stream ${args.pluginId}.${args.streamId} is not available`)
      if (streamDefinition.kind !== "logs") {
        throw new Error(`Plugin stream ${args.pluginId}.${args.streamId} is not a logs stream`)
      }
      const entity = resolvePluginEntity(args.pluginId, args.entityKind, args.entityId)
      const input = parseJsonInput(args.inputJson)
      const maxBatches = clampPluginLogBatches(args.maxBatches)
      const client = await getConnectedClient(deps, args.nodeId, context)
      const lines: Array<string> = []
      let batchesRead = 0
      const read = Stream.runForEach(
        client["plugins.logs"]({
          pluginId: args.pluginId,
          streamId: args.streamId,
          ...(entity !== undefined ? { entity } : {}),
          ...(input !== undefined ? { input } : {}),
        }).pipe(Stream.take(maxBatches)),
        (batch: LogBatch) =>
          Effect.sync(() => {
            batchesRead += 1
            const next = batch.lines.slice(0, MAX_PLUGIN_LOG_LINES - lines.length)
            if (next.length === 0) return
            lines.push(...next)
            api.output(`${next.join("\n")}\n`)
          }),
      )
      const completion = await run(Effect.scoped(read.pipe(Effect.timeoutOption("3 seconds"))), context)
      return textResult(lines.join("\n").trim() || "(no log output)", {
        nodeId: args.nodeId,
        pluginId: args.pluginId,
        streamId: args.streamId,
        entity,
        input,
        maxBatches,
        batchesRead,
        lineCount: lines.length,
        timedOut: Option.isNone(completion),
      })
    },
  })

  const bashRun = defineTool({
    name: OperatorToolNames.bashRun,
    description:
      "Execute a shell command on one scoped node over the Scout PTY transport and return the terminal output.",
    parameters: bashRunSchema,
    replay: "safe",
    execute: async (args, api, context) => {
      const meta = await readSessionMeta(api, context)
      requireScopedNode(meta, args.nodeId)
      const gated = await gate(api, OperatorToolNames.bashRun, args, meta, context)
      if (gated !== undefined) return gated
      const client = await getConnectedClient(deps, args.nodeId, context)
      let terminalSessionId = ""
      let exitCode: number | null = null
      let mirroredBytes = 0
      const chunks: Array<string> = []
      const mirrored: Array<string> = []
      const publish = () => {
        const details = { terminal: { nodeId: args.nodeId, terminalSessionId, base64Chunks: [...mirrored] } }
        api.details(details, context).catch(() => {})
      }
      const read = Stream.runForEach(
        client["terminal.exec"]({ command: args.command, cols: BASH_RUN_COLS, rows: BASH_RUN_ROWS }),
        (chunk: TerminalOutput) =>
          Effect.sync(() => {
            if (chunk._tag === "session-start") {
              terminalSessionId = chunk.sessionId
              publish()
              return
            }
            if (chunk._tag === "exit") {
              exitCode = chunk.exitCode
              return
            }
            chunks.push(chunk.dataBase64)
            if (mirroredBytes + chunk.dataBase64.length <= MAX_TERMINAL_MIRROR_BASE64) {
              mirroredBytes += chunk.dataBase64.length
              mirrored.push(chunk.dataBase64)
              publish()
            }
          }),
      )
      let completion: Option.Option<void> | null = null
      let failure: unknown = null
      try {
        completion = await run(Effect.scoped(read.pipe(Effect.timeoutOption(BASH_RUN_TIMEOUT))), context)
      } catch (error) {
        failure = error
      }
      const timedOut = completion !== null && Option.isNone(completion)
      if ((timedOut || failure !== null) && terminalSessionId !== "") {
        await Effect.runPromise(
          client["terminal.close"]({ sessionId: terminalSessionId }).pipe(Effect.ignore),
        )
      }
      if (failure !== null) throw failure
      const text = await extractTerminalText({
        base64Chunks: chunks,
        cols: BASH_RUN_COLS,
        rows: BASH_RUN_ROWS,
      })
      const details = {
        nodeId: args.nodeId,
        label: args.label,
        command: args.command,
        exitCode,
        timedOut,
        terminal: { nodeId: args.nodeId, terminalSessionId, base64Chunks: mirrored },
      }
      if (timedOut) return textResult(text || "(command timed out after 30 seconds)", details)
      if (exitCode === null) throw new Error("terminal.exec ended without an exit code")
      if (exitCode !== 0) {
        return {
          ...textResult(`${text || "(no output)"}\n\nCommand exited with code ${exitCode}`, details),
          isError: true,
        }
      }
      return textResult(text || "(no output)", details)
    },
  })

  const askUser = defineTool({
    name: OperatorToolNames.askUser,
    description:
      "Ask the user a clarifying question and wait for the answer. Use when you need input to choose between approaches or clarify scope.",
    parameters: askUserSchema,
    replay: "safe",
    execute: async (args, api, context) => {
      const record = await awaitDecision(
        api,
        { name: OperatorToolNames.askUser },
        {
          kind: "clarification",
          question: {
            question: args.question,
            header: args.header,
            options: args.options.map((option) => ({ label: option.label, description: option.description })),
            ...(args.multiple === undefined ? {} : { multiple: args.multiple }),
          },
        },
        context,
      )
      if (record.status !== "approved") {
        return errorResult("The user declined to answer. Continue with what you know or stop and explain.")
      }
      return textResult(`User answered: ${record.answer ?? "(no answer text)"}`, {
        answer: record.answer ?? null,
      })
    },
  })

  const pluginTools = deps.operatorPlugins.flatMap((plugin) =>
    (plugin.operator.tools ?? []).map((tool: ScoutOperatorTool) =>
      defineTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        replay: "safe",
        execute: async (args, api, context) => {
          const meta = await readSessionMeta(api, context)
          const gated = await gate(api, tool.name, args, meta, context)
          if (gated !== undefined) return gated
          const result = await tool.execute(args, {
            session: toPluginSessionContext(String(api.conversationId), meta),
            toolCallId: api.callId,
            signal: context.abortSignal,
            output: (chunk) => api.output(chunk),
          })
          return {
            ...(result.text === undefined ? {} : { content: [{ type: "text" as const, text: result.text }] }),
            ...(result.details === undefined ? {} : { details: json(result.details) }),
            ...(result.isError === true ? { isError: true } : {}),
          }
        },
      }),
    ),
  )

  const tools: Array<ToolRegistration> = [
    observeSystems,
    observeAlerts,
    observeMetrics,
    observePlugins,
    pluginRunAction,
    pluginLogs,
    bashRun,
    askUser,
    ...pluginTools,
  ] as Array<ToolRegistration>
  const seen = new Set<string>()
  for (const tool of tools) {
    if (seen.has(tool.name)) throw new Error(`Duplicate operator tool name registered: ${tool.name}`)
    seen.add(tool.name)
  }

  const observe = async (effect: () => Promise<void>): Promise<void> => {
    try {
      await effect()
    } catch {
      // Observation only.
    }
  }

  const pluginHookInput = async (call: ToolCall, api: HookApi, context: ChordContext) => {
    const meta = await readSessionMeta(api, context)
    return {
      session: toPluginSessionContext(String(api.conversationId), meta),
      toolName: call.name,
      args: call.arguments,
    }
  }

  const scout = defineExtension({
    name: "scout",
    tools,
    sections: [
      section(
        "scout",
        async (input, context) => {
          const meta = await readSessionMeta(
            { snapshot: input.read.snapshot, conversationId: input.conversationId },
            context,
          )
          return [
            deps.systemPrompt,
            `Current session scope: ${meta.selectedNodeIds.join(", ") || "(empty)"}.`,
            `Use ${OperatorToolNames.observeSystems}, ${OperatorToolNames.observeMetrics}, ${OperatorToolNames.observeAlerts}, and ${OperatorToolNames.observePlugins} before mutating tools when possible.`,
            `Set ${OperatorToolNames.bashRun}.isMutation to true only when the command changes system state.`,
            `Use ${OperatorToolNames.pluginRunAction} only for installed plugin actions discovered via ${OperatorToolNames.observePlugins}.`,
            `Use ${OperatorToolNames.pluginLogs} for bounded plugin log reads instead of opening unbounded streams.`,
            "Mutating calls may wait for the operator's approval; a rejected call reports the rejection.",
          ].join("\n")
        },
        { tag: false },
      ),
      section("skills", async (input, context) => {
        const meta = await readSessionMeta(
          { snapshot: input.read.snapshot, conversationId: input.conversationId },
          context,
        )
        if (meta.attachedSkillIds.length === 0) return undefined
        const skills = await run(deps.skills.resolve(meta.attachedSkillIds), context)
        return skills.map((skill) => [`Skill: ${skill.name}`, skill.content].join("\n")).join("\n\n")
      }),
      section("plugins", async (input, context) => {
        const meta = await readSessionMeta(
          { snapshot: input.read.snapshot, conversationId: input.conversationId },
          context,
        )
        const skills = await run(deps.skills.resolve(meta.attachedSkillIds), context)
        const sections = await run(
          deps.extensions.beforePrompt({
            session: toPluginSessionContext(String(input.conversationId), meta),
            attachedSkillContents: skills.map((skill) => skill.content),
          }),
          context,
        )
        return sections.length === 0 ? undefined : sections.join("\n\n")
      }),
    ],
    // Plugin hooks observe calls; their failures never block or change a call.
    hooks: [
      hook(ToolTask, {
        beforeTool: async (call, api, context) => {
          await observe(async () =>
            run(deps.extensions.beforeToolCall(await pluginHookInput(call, api, context)), context),
          )
          return undefined
        },
        afterTool: async (call, result, api, context) => {
          await observe(async () =>
            run(
              deps.extensions.afterToolCall({
                ...(await pluginHookInput(call, api, context)),
                result,
                isError: result.isError === true,
              }),
              context,
            ),
          )
          return undefined
        },
      }),
    ],
  })

  const plan = defineExtension({
    name: "scout-plan",
    sections: [
      section(
        "plan_mode",
        () =>
          "Plan mode is active. Investigate with read-only tools, then propose a step-by-step plan. " +
          "Mutating tools are disabled until the user leaves plan mode.",
      ),
    ],
    hooks: [
      hook(ToolTask, {
        beforeTool: (call) =>
          isPlanModeBlocked(call.name, call.arguments, deps.manifests, pluginOperatorTools)
            ? { block: "Plan mode is active. Propose a plan instead of executing mutations." }
            : undefined,
      }),
    ],
  })

  return { scout, plan, pluginOperatorTools }
}
