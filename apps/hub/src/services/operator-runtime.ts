import { Effect, Layer, Option, Ref, Stream } from "effect"
import * as Context from "effect/Context"
import { Terminal as HeadlessTerminal } from "@xterm/headless"
import {
  Agent,
  type AgentMessage,
  type AgentTool,
  type AfterToolCallContext,
  type AfterToolCallResult,
  type BeforeToolCallContext,
  type BeforeToolCallResult,
} from "@mariozechner/pi-agent-core"
import { Type } from "@mariozechner/pi-ai"
import type {
  OperatorSessionDetail,
  OperatorSessionEvent,
  LogBatch,
  TerminalOutput,
} from "@scout/shared"
import { ManagementError } from "@scout/shared"
import type {
  ActionDefinition,
  PluginManifest,
  ScoutOperatorTool,
  StreamDefinition,
} from "@scout/plugin-sdk"
import { desc, eq } from "drizzle-orm"
import { AgentRegistry, type HubAgentClient } from "../rpc/agent-bridge.js"
import * as schema from "../../drizzle/schema.js"
import type { OperatorResolvedModelConfig } from "./operator-model-registry.js"
import { OperatorExtensions } from "./operator-extensions.js"
import { OperatorSessionManager } from "./operator-session-manager.js"
import { MetricsIngestion } from "./metrics-ingestion.js"
import { PluginRegistry, type LoadedOperatorPlugin } from "./plugin-registry.js"
import { OperatorSessions } from "./operator-sessions.js"
import { Database, type ScoutDatabase } from "./database.js"

const textResult = (text: string, details?: unknown) => ({
  content: [{ type: "text" as const, text }],
  details: details ?? null,
})

const toManagementError = (code: string, message: string): ManagementError =>
  new ManagementError({ code, message })

const textFromContentBlocks = (contentBlocks: ReadonlyArray<unknown> | undefined): string =>
  (contentBlocks ?? [])
    .flatMap((block) => {
      if (
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return [block.text]
      }
      return []
    })
    .join("")
    .trim()

const textFromToolResultContent = (content: ReadonlyArray<unknown> | undefined): string =>
  (content ?? [])
    .flatMap((block) => {
      if (
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return [block.text]
      }
      return []
    })
    .join("")
    .trim()

const isDefaultSessionTitle = (title: string): boolean =>
  title.startsWith("New operator session") || title.startsWith("Operator session")

const generateSessionTitle = (
  model: OperatorResolvedModelConfig["model"],
  userMessage: string,
): Effect.Effect<string, ManagementError> =>
  Effect.tryPromise({
    try: async () => {
      const titleAgent = new Agent({
        initialState: {
          systemPrompt:
            "Generate a concise 3-5 word title for this conversation. Reply with only the title, no quotes or explanation.",
          model,
          tools: [],
        },
      })

      await titleAgent.prompt(userMessage)
      await titleAgent.waitForIdle()

      const lastMessage = titleAgent.state.messages.at(-1)
      if (
        lastMessage?.role === "assistant" &&
        Array.isArray(lastMessage.content)
      ) {
        const text = lastMessage.content
          .filter(
            (block: unknown): block is { type: "text"; text: string } =>
              typeof block === "object" &&
              block !== null &&
              "type" in block &&
              block.type === "text" &&
              "text" in block &&
              typeof block.text === "string",
          )
          .map((block) => block.text)
          .join("")
          .trim()

        if (text.length > 0) {
          return text.slice(0, 100)
        }
      }

      return "Operator session"
    },
    catch: () =>
      toManagementError("title-generation-failed", "Failed to generate session title"),
  })

const generateSessionSummary = (
  model: OperatorResolvedModelConfig["model"],
  recentContext: string,
): Effect.Effect<string, ManagementError> =>
  Effect.tryPromise({
    try: async () => {
      const summaryAgent = new Agent({
        initialState: {
          systemPrompt: "Summarize this operator session in 1-2 sentences. Focus on what was investigated and what actions were taken. Reply with only the summary.",
          model,
          tools: [],
        },
        sessionId: `summary-${Date.now()}`,
      })
      await summaryAgent.prompt(recentContext)
      await summaryAgent.waitForIdle()
      const last = summaryAgent.state.messages.at(-1)
      if (last?.role === "assistant") {
        return textFromContentBlocks(last.content as ReadonlyArray<unknown>).trim() || "Session in progress."
      }
      return "Session in progress."
    },
    catch: () => toManagementError("summary-generation-failed", "Failed to generate summary"),
  })

const persistOperatorMessage = (
  operatorSessions: {
    readonly appendEvent: (
      event: Omit<OperatorSessionEvent, "seq">,
    ) => Effect.Effect<OperatorSessionEvent>
  },
  sessionId: string,
  message: Extract<AgentMessage, { role: "assistant" }>,
) =>
  operatorSessions.appendEvent({
    id: crypto.randomUUID(),
    sessionId,
    at: Date.now(),
    type: "message.created",
    message: {
      id: crypto.randomUUID(),
      sessionId,
      role: "assistant",
      content: textFromContentBlocks(message.content),
      contentBlocks: message.content as Array<unknown>,
      createdAt: Date.now(),
    },
  })

type OperatorSessionAppender = {
  readonly appendEvent: (
    event: Omit<OperatorSessionEvent, "seq">,
  ) => Effect.Effect<OperatorSessionEvent>
}

type AgentClientRegistry = {
  readonly getClient: (agentId: string) => Effect.Effect<HubAgentClient | null>
}

export type PluginInventoryManifest = Pick<
  PluginManifest,
  "id" | "displayName" | "actions" | "streams" | "metrics" | "entityKinds"
>

export type PluginOperatorToolPolicy = {
  readonly requiresConfirmation: boolean
}

const DEFAULT_PLUGIN_LOG_BATCHES = 4
const MAX_PLUGIN_LOG_BATCHES = 10
const MAX_PLUGIN_LOG_LINES = 200
const BASH_RUN_COLS = 120
const BASH_RUN_ROWS = 40
const BASH_RUN_TIMEOUT = "30 seconds"

const requireScopedNode = (
  session: OperatorSessionDetail["session"],
  nodeId: string,
): void => {
  if (!session.selectedNodeIds.includes(nodeId)) {
    throw new Error(
      `Node ${nodeId} is outside the session scope (${session.selectedNodeIds.join(", ")})`,
    )
  }
}

const parseJsonInput = (inputJson: string | undefined): unknown => {
  if (inputJson === undefined || inputJson.trim().length === 0) {
    return undefined
  }

  return JSON.parse(inputJson)
}

const resolvePluginEntity = (
  pluginId: string,
  entityKind: string | undefined,
  entityId: string | undefined,
) => {
  if (entityKind === undefined && entityId === undefined) {
    return undefined
  }

  if (entityKind === undefined || entityId === undefined) {
    throw new Error("Both entityKind and entityId are required when targeting a plugin entity")
  }

  return {
    pluginId,
    kind: entityKind,
    id: entityId,
  }
}

const clampPluginLogBatches = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_PLUGIN_LOG_BATCHES
  }

  return Math.min(MAX_PLUGIN_LOG_BATCHES, Math.max(1, Math.floor(value)))
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

export const requiresOperatorApproval = (
  toolName: string,
  args: unknown,
  manifests: ReadonlyMap<string, PluginInventoryManifest>,
  pluginOperatorTools: ReadonlyMap<string, PluginOperatorToolPolicy>,
  approvalMode: string,
): {
  readonly required: boolean
  readonly reason: string | null
} => {
  // auto_approve_all: never require approval
  if (approvalMode === "auto_approve_all") return { required: false, reason: null }

  // auto_approve_reads: only require for mutations
  if (approvalMode === "auto_approve_reads") {
    // observe tools, ask_user, plugin.logs: always safe
    if (toolName.startsWith("observe.") || toolName === "ask_user" || toolName === "plugin.logs") {
      return { required: false, reason: null }
    }
    // bash.run with isMutation: false is safe
    if (
      toolName === "bash.run" &&
      typeof args === "object" &&
      args !== null &&
      "isMutation" in args &&
      args.isMutation === false
    ) {
      return { required: false, reason: null }
    }
  }

  // confirm_each_mutation (and auto_approve_reads for mutations): existing logic
  if (
    toolName === "bash.run" &&
    typeof args === "object" &&
    args !== null &&
    "isMutation" in args &&
    args.isMutation === true
  ) {
    const reason =
      "label" in args && typeof args.label === "string"
        ? args.label
        : "Mutation requested by operator"

    return { required: true, reason }
  }

  if (
    toolName === "plugin.runAction" &&
    typeof args === "object" &&
    args !== null &&
    "pluginId" in args &&
    typeof args.pluginId === "string" &&
    "actionId" in args &&
    typeof args.actionId === "string"
  ) {
    const action = findPluginActionDefinition(manifests, args.pluginId, args.actionId)
    if (action?.requiresConfirmation === true) {
      return {
        required: true,
        reason: `Plugin action ${args.pluginId}.${args.actionId} requires approval`,
      }
    }
  }

  const pluginTool = pluginOperatorTools.get(toolName)
  if (pluginTool?.requiresConfirmation === true) {
    return {
      required: true,
      reason: `Operator tool ${toolName} requires approval`,
    }
  }

  return { required: false, reason: null }
}

const formatSystemsSnapshot = (
  rows: ReadonlyArray<typeof schema.systems.$inferSelect>,
): string => {
  if (rows.length === 0) {
    return "No systems are in the current session scope."
  }

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

const formatAlertsSnapshot = (
  rows: ReadonlyArray<typeof schema.alerts.$inferSelect>,
): string => {
  if (rows.length === 0) {
    return "No active alerts are currently in scope."
  }

  return rows
    .map((row) =>
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
  if (rows.length === 0) {
    return "No recent host metrics are available in the current session scope."
  }

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

const appendToolOutputBase64 = (
  operatorSessions: OperatorSessionAppender,
  sessionId: string,
  toolCallId: string,
  outputBase64: string,
) =>
  operatorSessions.appendEvent({
    id: crypto.randomUUID(),
    sessionId,
    at: Date.now(),
    type: "tool.updated",
    toolCallId,
    outputBase64,
  })

const appendToolOutputText = (
  operatorSessions: OperatorSessionAppender,
  sessionId: string,
  toolCallId: string,
  outputText: string,
) =>
  operatorSessions.appendEvent({
    id: crypto.randomUUID(),
    sessionId,
    at: Date.now(),
    type: "tool.updated",
    toolCallId,
    outputText,
  })

const appendTerminalProjection = (
  operatorSessions: OperatorSessionAppender,
  sessionId: string,
  toolCallId: string,
  nodeId: string,
  terminalSessionId: string,
) =>
  operatorSessions.appendEvent({
    id: crypto.randomUUID(),
    sessionId,
    at: Date.now(),
    type: "terminal.projected",
    projection: {
      id: crypto.randomUUID(),
      sessionId,
      toolCallId,
      nodeId,
      mode: "inline",
      streamRef: terminalSessionId,
    },
  })

const writeHeadlessChunk = (
  term: HeadlessTerminal,
  bytes: Uint8Array,
): Promise<void> =>
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

  return lines.join("\n").trimEnd()
}

const getConnectedClient = (
  registry: AgentClientRegistry,
  nodeId: string,
): Effect.Effect<HubAgentClient, Error> =>
  registry.getClient(nodeId).pipe(
    Effect.flatMap((client) =>
      client === null
        ? Effect.fail(new Error(`Node ${nodeId} is not currently connected`))
        : Effect.succeed(client),
    ),
  )

const bashToolSchema = Type.Object({
  nodeId: Type.String({ description: "Target node id from the current session scope" }),
  label: Type.String({ description: "Short description of why this command is being run" }),
  command: Type.String({ description: "Shell command to execute on the selected node" }),
  isMutation: Type.Boolean({
    description: "True only when the command changes system state; false for read-only diagnostics",
  }),
})

const scopedNodeIdsSchema = Type.Object({
  nodeIds: Type.Optional(
    Type.Array(Type.String({ description: "Optional subset of scoped node ids to inspect" })),
  ),
})

const pluginInventorySchema = Type.Object({
  nodeIds: Type.Optional(
    Type.Array(Type.String({ description: "Optional subset of scoped node ids to inspect" })),
  ),
  pluginId: Type.Optional(
    Type.String({ description: "Optional plugin id to narrow discovery" }),
  ),
})

const pluginActionSchema = Type.Object({
  nodeId: Type.String({ description: "Target node id from the current session scope" }),
  pluginId: Type.String({ description: "Plugin id to target on the selected node" }),
  actionId: Type.String({ description: "Plugin action id from observe.plugins" }),
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
  streamId: Type.String({ description: "Plugin log stream id from observe.plugins" }),
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

const createObserveSystemsTool = (
  db: ScoutDatabase,
  session: OperatorSessionDetail["session"],
): AgentTool<typeof scopedNodeIdsSchema> => ({
    name: "observe.systems",
    label: "observe.systems",
    description: "List scoped systems with current status and plugin capability summary.",
    parameters: scopedNodeIdsSchema,
    execute: async (_toolCallId, args) => {
      const requestedNodeIds = args.nodeIds ?? session.selectedNodeIds
      for (const nodeId of requestedNodeIds) {
        requireScopedNode(session, nodeId)
      }

      const rows = db.select().from(schema.systems).all()
      const filtered = rows.filter((row) => requestedNodeIds.includes(row.id))

      return textResult(formatSystemsSnapshot(filtered), {
        nodeIds: requestedNodeIds,
        systems: filtered,
      })
    },
  })

const createObserveAlertsTool = (
  db: ScoutDatabase,
  session: OperatorSessionDetail["session"],
): AgentTool<typeof scopedNodeIdsSchema> => ({
    name: "observe.alerts",
    label: "observe.alerts",
    description: "List active or acknowledged alerts within the current session scope.",
    parameters: scopedNodeIdsSchema,
    execute: async (_toolCallId, args) => {
      const requestedNodeIds = args.nodeIds ?? session.selectedNodeIds
      for (const nodeId of requestedNodeIds) {
        requireScopedNode(session, nodeId)
      }

      const rows = db.select().from(schema.alerts).all()
      const filtered = rows.filter(
        (row) =>
          requestedNodeIds.includes(row.systemId) &&
          (row.state === "active" || row.state === "acknowledged"),
      )

      return textResult(formatAlertsSnapshot(filtered), {
        nodeIds: requestedNodeIds,
        alerts: filtered,
      })
    },
  })

const createObserveMetricsTool = (
  metricsIngestion: typeof MetricsIngestion.Service,
  session: OperatorSessionDetail["session"],
): AgentTool<typeof scopedNodeIdsSchema> => ({
  name: "observe.metrics",
  label: "observe.metrics",
  description:
    "Inspect the latest host metrics for scoped nodes, including CPU, memory, disk, network, and uptime.",
  parameters: scopedNodeIdsSchema,
  execute: async (_toolCallId, args) => {
    const requestedNodeIds = args.nodeIds ?? session.selectedNodeIds
    for (const nodeId of requestedNodeIds) {
      requireScopedNode(session, nodeId)
    }

    const metricRows = (
      await Promise.all(
        requestedNodeIds.map(async (systemId) => ({
          systemId,
          sample: await Effect.runPromise(metricsIngestion.queryLatest(systemId)),
        })),
      )
    ).filter(
      (
        row,
      ): row is {
        readonly systemId: string
        readonly sample: NonNullable<typeof row.sample>
      } => row.sample !== null,
    )

    const missingNodeIds = requestedNodeIds.filter(
      (nodeId) => !metricRows.some((row) => row.systemId === nodeId),
    )

    const text = [
      formatMetricsSnapshot(metricRows),
      ...(missingNodeIds.length > 0
        ? [`No recent host metrics found for: ${missingNodeIds.join(", ")}`]
        : []),
    ].join("\n")

    return textResult(text, {
      nodeIds: requestedNodeIds,
      metrics: metricRows,
      missingNodeIds,
    })
  },
})

const createObservePluginsTool = (
  db: ScoutDatabase,
  metricsIngestion: typeof MetricsIngestion.Service,
  manifests: ReadonlyMap<string, PluginInventoryManifest>,
  session: OperatorSessionDetail["session"],
): AgentTool<typeof pluginInventorySchema> => ({
  name: "observe.plugins",
  label: "observe.plugins",
  description:
    "Discover plugin capabilities in the current session scope, including actions, streams, entity counts, and recent activity.",
  parameters: pluginInventorySchema,
  execute: async (_toolCallId, args) => {
    const requestedNodeIds = args.nodeIds ?? session.selectedNodeIds
    for (const nodeId of requestedNodeIds) {
      requireScopedNode(session, nodeId)
    }

    const rows = db.select().from(schema.systems).all()
    const scopedSystems = rows.filter((row) => requestedNodeIds.includes(row.id))
    const pluginEntries = await Promise.all(
      scopedSystems.flatMap((row) => {
        const capabilities = (row.pluginCapabilities as Array<{ pluginId: string; status?: string; features?: ReadonlyArray<string> }> | null) ?? []
        return capabilities
          .filter((capability) =>
            args.pluginId === undefined ? true : capability.pluginId === args.pluginId,
          )
          .map(async (capability) => {
            const manifest = manifests.get(capability.pluginId)
            const entityCount = manifest
              ? (
                  await Effect.runPromise(
                    metricsIngestion.queryPluginEntities(row.id, capability.pluginId),
                  )
                ).length
              : 0
            const recentMetricCount = manifest
              ? (
                  await Effect.runPromise(
                    metricsIngestion.queryPluginMetricPoints(row.id, capability.pluginId, 24),
                  )
                ).length
              : 0
            const recentEventCount = manifest
              ? (
                  await Effect.runPromise(
                    metricsIngestion.queryPluginEvents(row.id, capability.pluginId, 24),
                  )
                ).length
              : 0

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
              entityCount,
              recentMetricCount,
              recentEventCount,
            }
          })
      }),
    )

    return textResult(formatPluginInventory(pluginEntries), {
      nodeIds: requestedNodeIds,
      plugins: pluginEntries,
    })
  },
})

const createPluginRunActionTool = (
  manifests: ReadonlyMap<string, PluginInventoryManifest>,
  registry: AgentClientRegistry,
  session: OperatorSessionDetail["session"],
): AgentTool<typeof pluginActionSchema> => ({
  name: "plugin.runAction",
  label: "plugin.runAction",
  description:
    "Execute a plugin action on one scoped node using the Scout hub-to-agent plugin management RPC.",
  parameters: pluginActionSchema,
  execute: async (_toolCallId, args) => {
    requireScopedNode(session, args.nodeId)

    const action = findPluginActionDefinition(manifests, args.pluginId, args.actionId)
    if (action === null) {
      throw new Error(`Plugin action ${args.pluginId}.${args.actionId} is not available`)
    }

    const entity = resolvePluginEntity(args.pluginId, args.entityKind, args.entityId)
    const input = parseJsonInput(args.inputJson)
    const client = await Effect.runPromise(getConnectedClient(registry, args.nodeId))
    const result = await Effect.runPromise(
      client["plugins.runAction"]({
        pluginId: args.pluginId,
        actionId: args.actionId,
        ...(entity !== undefined ? { entity } : {}),
        ...(input !== undefined ? { input } : {}),
      }).pipe(Effect.mapError((error) => new Error(error.message))),
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
      ...(entity !== undefined ? { entity } : {}),
      ...(input !== undefined ? { input } : {}),
      result,
    })
  },
})

const createPluginLogsTool = (
  operatorSessions: OperatorSessionAppender,
  manifests: ReadonlyMap<string, PluginInventoryManifest>,
  registry: AgentClientRegistry,
  session: OperatorSessionDetail["session"],
): AgentTool<typeof pluginLogsSchema> => ({
  name: "plugin.logs",
  label: "plugin.logs",
  description:
    "Read a bounded slice of plugin log output from one scoped node without opening a long-lived tail.",
  parameters: pluginLogsSchema,
  execute: async (toolCallId, args) => {
    requireScopedNode(session, args.nodeId)

    const streamDefinition = findPluginStreamDefinition(manifests, args.pluginId, args.streamId)
    if (streamDefinition === null) {
      throw new Error(`Plugin stream ${args.pluginId}.${args.streamId} is not available`)
    }
    if (streamDefinition.kind !== "logs") {
      throw new Error(
        `Plugin stream ${args.pluginId}.${args.streamId} is not a logs stream and cannot be used with plugin.logs`,
      )
    }

    const entity = resolvePluginEntity(args.pluginId, args.entityKind, args.entityId)
    const input = parseJsonInput(args.inputJson)
    const maxBatches = clampPluginLogBatches(args.maxBatches)
    const client = await Effect.runPromise(getConnectedClient(registry, args.nodeId))

    const lines: Array<string> = []
    let batchesRead = 0

    const run = Stream.runForEach(
      client["plugins.logs"]({
        pluginId: args.pluginId,
        streamId: args.streamId,
        ...(entity !== undefined ? { entity } : {}),
        ...(input !== undefined ? { input } : {}),
      }).pipe(Stream.take(maxBatches)),
      (batch: LogBatch) =>
        Effect.gen(function* () {
          batchesRead += 1
          const remaining = MAX_PLUGIN_LOG_LINES - lines.length
          if (remaining <= 0) return

          const nextLines = batch.lines.slice(0, remaining)
          if (nextLines.length === 0) return

          lines.push(...nextLines)
          yield* appendToolOutputText(
            operatorSessions,
            session.id,
            toolCallId,
            `${nextLines.join("\n")}\n`,
          )
        }),
    )

    const completion = await Effect.runPromise(
      Effect.scoped(run.pipe(Effect.timeoutOption("3 seconds"))),
    )

    const timedOut = Option.isNone(completion)
    const output = lines.join("\n").trim()

    return textResult(output || "(no log output)", {
      nodeId: args.nodeId,
      pluginId: args.pluginId,
      streamId: args.streamId,
      ...(entity !== undefined ? { entity } : {}),
      ...(input !== undefined ? { input } : {}),
      maxBatches,
      batchesRead,
      lineCount: lines.length,
      timedOut,
      streamDefinition,
    })
  },
})

const createBashRunTool = (
  operatorSessions: OperatorSessionAppender,
  registry: AgentClientRegistry,
  session: OperatorSessionDetail["session"],
): AgentTool<typeof bashToolSchema> => ({
  name: "bash.run",
  label: "bash.run",
  description:
    "Execute a shell command on one scoped node over the existing Scout PTY transport and return the terminal output.",
  parameters: bashToolSchema,
  execute: async (toolCallId, args) => {
    requireScopedNode(session, args.nodeId)

    const client = await Effect.runPromise(getConnectedClient(registry, args.nodeId))
    let terminalSessionId: string | null = null
    let exitCode: number | null = null
    const outputBase64Chunks: Array<string> = []

    const openStream = client["terminal.exec"]({
      command: args.command,
      cols: BASH_RUN_COLS,
      rows: BASH_RUN_ROWS,
    })

    const run = Stream.runForEach(openStream, (chunk: TerminalOutput) =>
      Effect.gen(function* () {
        if (chunk._tag === "session-start") {
          terminalSessionId = chunk.sessionId

          yield* appendTerminalProjection(
            operatorSessions,
            session.id,
            toolCallId,
            args.nodeId,
            chunk.sessionId,
          )

          return
        }

        if (chunk._tag === "exit") {
          exitCode = chunk.exitCode
          return
        }

        outputBase64Chunks.push(chunk.dataBase64)
        yield* appendToolOutputBase64(operatorSessions, session.id, toolCallId, chunk.dataBase64)
      }),
    )

    let completion: Option.Option<void> | null = null
    let runError: unknown = null

    try {
      completion = await Effect.runPromise(
        Effect.scoped(run.pipe(Effect.timeoutOption(BASH_RUN_TIMEOUT))),
      )
    } catch (error) {
      runError = error
    }

    const timedOut = completion !== null && Option.isNone(completion)

    if ((timedOut || runError !== null) && terminalSessionId !== null) {
      await Effect.runPromise(
        client["terminal.close"]({ sessionId: terminalSessionId }).pipe(Effect.ignore),
      )
    }

    const cleanedOutput = await extractTerminalText({
      base64Chunks: outputBase64Chunks,
      cols: BASH_RUN_COLS,
      rows: BASH_RUN_ROWS,
    })

    if (runError !== null) {
      throw runError
    }

    if (timedOut) {
      return textResult(cleanedOutput || "(command timed out after 30 seconds)", {
        nodeId: args.nodeId,
        label: args.label,
        command: args.command,
        exitCode: null,
        terminalSessionId,
        timedOut: true,
      })
    }

    if (exitCode === null) {
      throw new Error("terminal.exec ended without an exit code")
    }

    if (exitCode !== 0) {
      throw new Error((cleanedOutput || "(no output)") + `\n\nCommand exited with code ${exitCode}`)
    }

    return textResult(cleanedOutput || "(no output)", {
      nodeId: args.nodeId,
      label: args.label,
      command: args.command,
      exitCode,
      terminalSessionId,
    })
  },
})

const toOperatorSessionContext = (
  session: OperatorSessionDetail["session"],
): {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly selectedNodeIds: ReadonlyArray<string>
  readonly attachedSkillIds: ReadonlyArray<string>
  readonly approvalMode: string
  readonly planMode: string | undefined
  readonly modelProviderId: string
  readonly modelId: string
} => ({
  id: session.id,
  title: session.title,
  status: session.status,
  selectedNodeIds: session.selectedNodeIds,
  attachedSkillIds: session.attachedSkillIds,
  approvalMode: session.approvalMode,
  planMode: session.planMode,
  modelProviderId: session.modelProviderId,
  modelId: session.modelId,
})

const wrapPluginOperatorTool = (
  tool: ScoutOperatorTool<any, any>,
  session: OperatorSessionDetail["session"],
): AgentTool<any> => ({
  name: tool.name,
  label: tool.label,
  description: tool.description,
  parameters: tool.parameters,
  execute: (toolCallId, params, signal, onUpdate) =>
    tool.execute(toolCallId, params, signal, onUpdate, {
      session: toOperatorSessionContext(session),
    }),
})

const ensureUniqueToolNames = (tools: ReadonlyArray<AgentTool<any>>): Array<AgentTool<any>> => {
  const seen = new Set<string>()
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate operator tool name registered: ${tool.name}`)
    }
    seen.add(tool.name)
  }
  return [...tools]
}

const askUserSchema = Type.Object({
  question: Type.String({ description: "The complete question to ask" }),
  header: Type.String({ description: "Short label (max 30 chars)" }),
  options: Type.Array(Type.Object({
    label: Type.String({ description: "Choice label (1-5 words)" }),
    description: Type.String({ description: "What this choice means" }),
  })),
  multiple: Type.Optional(Type.Boolean({ description: "Allow multiple selections" })),
})

const createAskUserTool = (
  _session: OperatorSessionDetail["session"],
): AgentTool<typeof askUserSchema> => ({
  name: "ask_user",
  label: "ask_user",
  description: "Ask the user a clarifying question. Use when you need input to choose between approaches or clarify scope.",
  parameters: askUserSchema,
  execute: async (_toolCallId, args) => {
    return textResult(args.question, { options: args.options, multiple: args.multiple })
  },
})

const createTools = (
  db: ScoutDatabase,
  ingestion: typeof MetricsIngestion.Service,
  operatorSessions: OperatorSessionAppender,
  manifests: ReadonlyMap<string, PluginInventoryManifest>,
  registry: AgentClientRegistry,
  operatorPlugins: ReadonlyArray<LoadedOperatorPlugin>,
  session: OperatorSessionDetail["session"],
): Array<AgentTool<any>> =>
  ensureUniqueToolNames([
    createObserveSystemsTool(db, session),
    createObserveAlertsTool(db, session),
    createObserveMetricsTool(ingestion, session),
    createObservePluginsTool(db, ingestion, manifests, session),
    createPluginRunActionTool(manifests, registry, session),
    createPluginLogsTool(operatorSessions, manifests, registry, session),
    createBashRunTool(operatorSessions, registry, session),
    createAskUserTool(session),
    ...operatorPlugins.flatMap((plugin) =>
      (plugin.operator.tools ?? []).map((tool) => wrapPluginOperatorTool(tool, session)),
    ),
  ])

const toolNodeIds = (
  args: unknown,
  sessionNodeIds: ReadonlyArray<string>,
): Array<string> => {
  if (typeof args !== "object" || args === null) return [...sessionNodeIds]
  if ("nodeId" in args && typeof args.nodeId === "string") return [args.nodeId]
  if ("nodeIds" in args && Array.isArray(args.nodeIds) && args.nodeIds.length > 0) {
    return args.nodeIds.filter((value): value is string => typeof value === "string")
  }
  return [...sessionNodeIds]
}

export class OperatorRuntime extends Context.Service<
  OperatorRuntime,
  {
    readonly ensureSession: (sessionId: string) => Effect.Effect<void, ManagementError>
    readonly prompt: (sessionId: string) => Effect.Effect<void, ManagementError>
  }
>()(
  "@scout/OperatorRuntime",
  {
    make: Effect.gen(function* () {
      const db = yield* Database
      const registry = yield* AgentRegistry
      const ingestion = yield* MetricsIngestion
      const pluginRegistry = yield* PluginRegistry
      const operatorSessions = yield* OperatorSessions
      const operatorSessionManager = yield* OperatorSessionManager
      const operatorExtensions = yield* OperatorExtensions
      const loadedPlugins = yield* pluginRegistry.list()
      const operatorPlugins = yield* pluginRegistry.listOperatorPlugins()
      const pluginManifests = new Map<string, PluginInventoryManifest>(
        loadedPlugins.map((plugin) => [
          plugin.manifest.id,
          {
            id: plugin.manifest.id,
            displayName: plugin.manifest.displayName,
            actions: plugin.manifest.actions,
            streams: plugin.manifest.streams,
            metrics: plugin.manifest.metrics,
            entityKinds: plugin.manifest.entityKinds,
          },
        ]),
      )
      const pluginOperatorTools = new Map<string, PluginOperatorToolPolicy>(
        operatorPlugins.flatMap((plugin) =>
          (plugin.operator.tools ?? []).map((tool) => [
            tool.name,
            {
              requiresConfirmation: tool.requiresConfirmation !== false,
            },
          ] as const),
        ),
      )
      const runtimes = yield* Ref.make(new Map<string, Agent>())
      const activeSessions = yield* Ref.make(new Set<string>())

      const subscribeToAgentEvents = (
        sessionId: string,
        agent: Agent,
      ) => {
        let lastStreamEmit = 0
        const STREAM_THROTTLE_MS = 100

        agent.subscribe(async (event) => {
          if (event.type === "message_end" && event.message.role === "assistant") {
            await Effect.runPromise(
              persistOperatorMessage(operatorSessions, sessionId, event.message).pipe(
                Effect.ignore,
              ),
            )
            return
          }

          if (
            (event.type === "message_start" || event.type === "message_update") &&
            event.message.role === "assistant"
          ) {
            const now = Date.now()
            if (event.type === "message_update" && now - lastStreamEmit < STREAM_THROTTLE_MS) return
            lastStreamEmit = now

            const text = textFromContentBlocks(event.message.content as ReadonlyArray<unknown>)

            await Effect.runPromise(
              operatorSessions.publishTransient({
                id: `streaming-${sessionId}-${now}`,
                sessionId,
                seq: -1,
                at: now,
                type: "message.streaming",
                message: {
                  id: `streaming-${sessionId}`,
                  sessionId,
                  role: "assistant",
                  content: text,
                  createdAt: now,
                },
              }).pipe(Effect.ignore),
            )
          }
        })
      }

      const createAgent = (
        sessionId: string,
        resolvedModelConfig: OperatorResolvedModelConfig,
      ) => {
        const agent = new Agent({
          initialState: {
            systemPrompt: resolvedModelConfig.systemPrompt,
            model: resolvedModelConfig.model,
            thinkingLevel: resolvedModelConfig.thinkingLevel,
            tools: [],
          },
          toolExecution: "parallel",
          sessionId,
        })

        subscribeToAgentEvents(sessionId, agent)
        return agent
      }

      const getOrCreateAgent = (sessionId: string) =>
        Effect.gen(function* () {
          const existing = yield* Ref.get(runtimes).pipe(
            Effect.map((entries) => entries.get(sessionId) ?? null),
          )
          if (existing !== null) {
            return existing
          }

          const prepared = yield* operatorSessionManager.prepareRuntime(sessionId)
          const created = createAgent(sessionId, prepared.resolvedModelConfig)
          yield* Ref.update(runtimes, (entries) => new Map(entries).set(sessionId, created))
          return created
        })

      const ensureSession = (sessionId: string) =>
        operatorSessionManager.get(sessionId).pipe(
          Effect.flatMap((detail) =>
            detail === null
              ? Effect.fail(
                  toManagementError(
                    "session-not-found",
                    `Operator session ${sessionId} not found`,
                  ),
                )
              : getOrCreateAgent(sessionId).pipe(Effect.asVoid),
          ),
        )

      const prompt = (sessionId: string) =>
        operatorSessionManager.get(sessionId).pipe(
          Effect.flatMap((detail) =>
            detail === null
              ? Effect.fail(
                  toManagementError(
                    "session-not-found",
                    `Operator session ${sessionId} not found`,
                  ),
                )
              : Effect.gen(function* () {
                  const alreadyActive = yield* Ref.modify(activeSessions, (sessions) => {
                    if (sessions.has(sessionId)) {
                      return [true, sessions] as const
                    }

                    return [false, new Set(sessions).add(sessionId)] as const
                  })

                  if (alreadyActive) {
                    return yield* Effect.fail(
                      toManagementError(
                        "operator-session-busy",
                        `Operator session ${sessionId} is already running`,
                      ),
                    )
                  }

                  const agent = yield* getOrCreateAgent(sessionId)
                  const toolMeta = new Map<
                    string,
                    {
                      readonly startedAt: number
                      readonly nodeIds: ReadonlyArray<string>
                      readonly input: unknown
                      readonly name: string
                    }
                  >()

                  agent.beforeToolCall = async (
                    context: BeforeToolCallContext,
                  ): Promise<BeforeToolCallResult | undefined> => {
                    const startedAt = Date.now()
                    const nodeIds = toolNodeIds(context.args, detail.session.selectedNodeIds)

                    toolMeta.set(context.toolCall.id, {
                      startedAt,
                      nodeIds,
                      input: context.args,
                      name: context.toolCall.name,
                    })

                    await Effect.runPromise(
                      operatorExtensions.beforeToolCall({
                        session: detail.session,
                        toolName: context.toolCall.name,
                        args: context.args,
                      }).pipe(Effect.ignore),
                    )

                    await Effect.runPromise(
                      operatorSessions.appendEvent({
                        id: crypto.randomUUID(),
                        sessionId,
                        at: startedAt,
                        type: "tool.started",
                        toolCall: {
                          id: context.toolCall.id,
                          sessionId,
                          name: context.toolCall.name,
                          status: "running",
                          nodeIds: [...nodeIds],
                          input: context.args,
                          startedAt,
                        },
                      }).pipe(Effect.ignore),
                    )

                    // ask_user tool always requires a clarification approval
                    if (context.toolCall.name === "ask_user") {
                      await Effect.runPromise(
                        operatorSessions.appendEvent({
                          id: crypto.randomUUID(),
                          sessionId,
                          at: Date.now(),
                          type: "approval.requested",
                          approval: {
                            id: crypto.randomUUID(),
                            sessionId,
                            toolCallId: context.toolCall.id,
                            reason: typeof context.args === "object" && context.args !== null && "question" in context.args ? String(context.args.question) : "Operator question",
                            affectedNodeIds: [],
                            kind: "clarification",
                            status: "pending",
                            requestedAt: Date.now(),
                            questionData: context.args as any,
                          },
                        }).pipe(Effect.ignore),
                      )
                      return {
                        block: true,
                        reason: "Waiting for user response to clarifying question.",
                      }
                    }

                    const approval = requiresOperatorApproval(
                      context.toolCall.name,
                      context.args,
                      pluginManifests,
                      pluginOperatorTools,
                      detail.session.approvalMode,
                    )

                    if (approval.required) {
                      const affectedNodeIds = toolNodeIds(context.args, detail.session.selectedNodeIds)

                      await Effect.runPromise(
                        operatorSessions.appendEvent({
                          id: crypto.randomUUID(),
                          sessionId,
                          at: Date.now(),
                          type: "approval.requested",
                          approval: {
                            id: crypto.randomUUID(),
                            sessionId,
                            toolCallId: context.toolCall.id,
                            reason: approval.reason ?? "Approval required",
                            affectedNodeIds,
                            kind: "mutation",
                            status: "pending",
                            requestedAt: Date.now(),
                          },
                        }).pipe(Effect.ignore),
                      )

                      return {
                        block: true,
                        reason: "Mutation requires approval. Wait for the user to approve it before proceeding.",
                      }
                    }

                    // Plan mode enforcement: block mutating tools
                    if (detail.session.planMode === "plan_first") {
                      const isMutationTool =
                        (context.toolCall.name === "bash.run" &&
                          typeof context.args === "object" &&
                          context.args !== null &&
                          "isMutation" in context.args &&
                          context.args.isMutation === true) ||
                        (context.toolCall.name === "plugin.runAction") ||
                        (pluginOperatorTools.has(context.toolCall.name) &&
                          pluginOperatorTools.get(context.toolCall.name)?.requiresConfirmation === true)

                      if (isMutationTool) {
                        return {
                          block: true,
                          reason: "Plan mode is active. Propose a plan before executing mutations.",
                        }
                      }
                    }

                    return undefined
                  }

                  agent.afterToolCall = async (
                    context: AfterToolCallContext,
                  ): Promise<AfterToolCallResult | undefined> => {
                    const meta = toolMeta.get(context.toolCall.id)
                    const finishedAt = Date.now()

                    await Effect.runPromise(
                      operatorExtensions.afterToolCall({
                        session: detail.session,
                        toolName: context.toolCall.name,
                        args: context.args,
                        result: context.result,
                        isError: context.isError,
                      }).pipe(Effect.ignore),
                    )

                    await Effect.runPromise(
                      operatorSessions.appendEvent({
                        id: crypto.randomUUID(),
                        sessionId,
                        at: finishedAt,
                        type: "tool.finished",
                        toolCall: {
                          id: context.toolCall.id,
                          sessionId,
                          name: context.toolCall.name,
                          status: context.isError ? "failed" : "completed",
                          nodeIds: meta?.nodeIds ? [...meta.nodeIds] : [],
                          input: meta?.input ?? context.args,
                          output: context.result,
                          summary: textFromToolResultContent(context.result.content).slice(0, 400) || undefined,
                          startedAt: meta?.startedAt ?? finishedAt,
                          finishedAt,
                        },
                      }).pipe(Effect.ignore),
                    )

                    toolMeta.delete(context.toolCall.id)
                    return undefined
                  }

                  const run = Effect.tryPromise({
                    try: async () => {
                      const prepared = await Effect.runPromise(
                        operatorSessionManager.prepareRuntime(sessionId),
                      )
                      agent.state.systemPrompt = [
                        prepared.systemPrompt,
                        `Current session scope: ${detail.session.selectedNodeIds.join(", ") || "(empty)"}.`,
                        "Use observe.systems, observe.metrics, observe.alerts, and observe.plugins before mutating tools when possible.",
                        "Set bash.run.isMutation to true only when the command changes system state.",
                        "Use plugin.runAction only for installed plugin actions discovered via observe.plugins.",
                        "Use plugin.logs for bounded plugin log reads instead of opening unbounded streams.",
                      ].join("\n")
                      agent.state.model = prepared.resolvedModelConfig.model
                      agent.state.thinkingLevel = prepared.resolvedModelConfig.thinkingLevel
                      agent.state.tools = createTools(
                        db,
                        ingestion,
                        operatorSessions,
                        pluginManifests,
                        registry,
                        operatorPlugins,
                        detail.session,
                      )
                      agent.state.messages = [...prepared.messages]

                      await agent.waitForIdle()

                      const lastMessage = agent.state.messages.at(-1)
                      if (lastMessage?.role !== "user" && lastMessage?.role !== "toolResult") {
                        throw new Error(
                          `Operator session ${sessionId} has no resumable user or toolResult message`,
                        )
                      }

                      await agent.continue()
                    },
                    catch: (error) =>
                      toManagementError(
                        "operator-runtime-error",
                        error instanceof Error
                          ? error.message
                          : "Unknown operator runtime error",
                      ),
                  }).pipe(
                    Effect.ensuring(
                      Ref.update(activeSessions, (sessions) => {
                        const next = new Set(sessions)
                        next.delete(sessionId)
                        return next
                      }),
                    ),
                  )

                  yield* run

                  // Fire-and-forget title generation for sessions with default titles
                  if (isDefaultSessionTitle(detail.session.title)) {
                    const firstUserMessage = detail.entries.find(
                      (entry) =>
                        entry.kind === "message" &&
                        typeof entry.data === "object" &&
                        entry.data !== null &&
                        "role" in entry.data &&
                        entry.data.role === "user",
                    )
                    const userText =
                      firstUserMessage &&
                      typeof firstUserMessage.data === "object" &&
                      firstUserMessage.data !== null &&
                      "content" in firstUserMessage.data &&
                      typeof firstUserMessage.data.content === "string"
                        ? firstUserMessage.data.content
                        : null

                    if (userText !== null) {
                      yield* Effect.forkDetach(
                        operatorSessionManager.prepareRuntime(sessionId).pipe(
                          Effect.flatMap((prepared) =>
                            generateSessionTitle(prepared.resolvedModelConfig.model, userText),
                          ),
                          Effect.flatMap((title) =>
                            operatorSessions.setTitle(sessionId, title).pipe(
                              Effect.flatMap(() =>
                                operatorSessions.publishTransient({
                                  id: `title-${sessionId}-${Date.now()}`,
                                  sessionId,
                                  seq: -1,
                                  at: Date.now(),
                                  type: "session.title_updated",
                                  summary: title,
                                }),
                              ),
                            ),
                          ),
                          Effect.ignore,
                        ),
                      )
                    }
                  }

                  // Title re-generation every 10 user messages
                  const userMessageCount = detail.events.filter(
                    (e) => e.message?.role === "user",
                  ).length
                  if (userMessageCount > 0 && userMessageCount % 10 === 0) {
                    const latestUserMessage = [...detail.events]
                      .reverse()
                      .find((e) => e.message?.role === "user")
                    const latestText = latestUserMessage?.message?.content
                    if (latestText) {
                      yield* Effect.forkDetach(
                        operatorSessionManager.prepareRuntime(sessionId).pipe(
                          Effect.flatMap((prepared) =>
                            generateSessionTitle(prepared.resolvedModelConfig.model, latestText),
                          ),
                          Effect.flatMap((title) =>
                            operatorSessions.setTitle(sessionId, title).pipe(
                              Effect.flatMap(() =>
                                operatorSessions.publishTransient({
                                  id: `title-${sessionId}-${Date.now()}`,
                                  sessionId,
                                  seq: -1,
                                  at: Date.now(),
                                  type: "session.title_updated",
                                  summary: title,
                                }),
                              ),
                            ),
                          ),
                          Effect.ignore,
                        ),
                      )
                    }
                  }

                  // Fire-and-forget summary generation after each turn
                  yield* Effect.forkDetach(
                    Effect.gen(function* () {
                      const events = yield* Effect.sync(() =>
                        db.select().from(schema.operatorSessionEvents)
                          .where(eq(schema.operatorSessionEvents.sessionId, sessionId))
                          .orderBy(desc(schema.operatorSessionEvents.seq))
                          .limit(10).all()
                      )
                      const context = events.reverse().map(e => {
                        const payload = e.payload as any
                        return `[${payload.type}] ${payload.message?.content ?? payload.toolCall?.name ?? payload.summary ?? ""}`
                      }).join("\n")

                      const prepared = yield* operatorSessionManager.prepareRuntime(sessionId)
                      const summary = yield* generateSessionSummary(prepared.resolvedModelConfig.model, context)
                      yield* operatorSessions.setSummary(sessionId, summary)
                      yield* operatorSessions.publishTransient({
                        id: `summary-${sessionId}-${Date.now()}`,
                        sessionId,
                        seq: -1,
                        at: Date.now(),
                        type: "session.summary_updated",
                        summary,
                      })
                    }).pipe(Effect.ignore),
                  )
                }) as Effect.Effect<void, ManagementError>,
          ),
        )

      return {
        ensureSession,
        prompt,
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
