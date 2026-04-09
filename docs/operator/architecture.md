# Scout Operator -- Architecture

This document describes the internal architecture of the Scout operator for developers extending or maintaining the system.

## Service Graph

The operator is implemented as 7 hub services with explicit dependency edges, all composed in `apps/hub/src/app.ts`:

```
OperatorRuntime
  +-- Database
  +-- MetricsIngestion
  +-- AgentRegistry
  +-- OperatorModelRegistry
  +-- OperatorSessions
  +-- OperatorSessionManager
  |     +-- OperatorSessions
  |     +-- OperatorSkills
  |     |     +-- PluginRegistry
  |     +-- OperatorResources
  |     |     +-- PluginRegistry
  |     +-- OperatorModelRegistry
  |     +-- OperatorExtensions
  |           +-- PluginRegistry
  +-- OperatorExtensions
  +-- PluginRegistry
```

### Service Roles

| Service | Location | Role |
|---------|----------|------|
| `OperatorRuntime` | `operator-runtime.ts` | Top-level orchestrator. Creates pi-agent-core `Agent` instances, manages tool sets, wires `beforeToolCall`/`afterToolCall` hooks, drives prompt execution, and spawns fire-and-forget title/summary subagents. |
| `OperatorSessions` | `operator-sessions.ts` | Persistence layer. Owns all database reads/writes for sessions, events, entries, tool calls, approvals, terminal projections, and plan snapshots. Manages the append-only event log and PubSub for transient events. |
| `OperatorSessionManager` | `operator-session-manager.ts` | High-level session lifecycle. Coordinates create, branch, fork, and skill attachment. Resolves model configs, builds system prompts, and prepares runtime state from the entry tree. |
| `OperatorModelRegistry` | `operator-model-registry.ts` | Discovers available pi-ai providers and models at startup. Resolves the default model from `SCOUT_OPERATOR_MODEL_PROVIDER` / `SCOUT_OPERATOR_MODEL_ID` env vars. Provides per-session model resolution. |
| `OperatorSkills` | `operator-skills.ts` | Discovers SKILL.md files from built-in directory, configured directories (`SCOUT_OPERATOR_SKILLS_DIRS`), and plugin-contributed skills. Provides list and resolve operations. |
| `OperatorResources` | `operator-resources.ts` | Collects built-in and plugin-contributed reference resources available to the operator. |
| `OperatorExtensions` | `operator-extensions.ts` | Plugin hook bridge. Runs `beforePrompt`, `beforeToolCall`, and `afterToolCall` hooks from all loaded plugin operator surfaces. Also injects the plugin surface summary into the system prompt. |

## Session Lifecycle

### Create

1. Client calls `operator.sessions.create` with optional title, node scope, and skill attachments
2. `OperatorSessionManager.create` resolves the default model, validates skill IDs, and delegates to `OperatorSessions.create`
3. `OperatorSessions.create` inserts a row into `operator_sessions` with status `active`, approval mode `confirm_each_mutation`, and event sequence 0
4. Available skills, resources, and models are augmented onto the returned `OperatorSessionDetail`

### Prompt

1. Client calls `operator.prompt` with session ID and prompt text
2. Hub RPC handler appends a `message.created` event (role: user) via `OperatorSessions.appendEvent`
3. Hub RPC handler calls `OperatorRuntime.prompt(sessionId)` (fire-and-forget to avoid blocking the RPC response)
4. `OperatorRuntime.prompt`:
   - Acquires an exclusive lock on the session (prevents concurrent prompts)
   - Gets or creates the pi-agent-core `Agent` instance
   - Calls `OperatorSessionManager.prepareRuntime` to rebuild the system prompt, model config, tool set, and message history from the entry tree
   - Hydrates `agent.state` with the prepared runtime state
   - Calls `agent.continue()` to resume the LLM turn
5. The agent processes the conversation, calling tools as needed
6. `subscribe` callback on the agent emits streaming events to the browser via PubSub
7. After the turn completes, fire-and-forget Effects generate title and summary updates

### Events

Events are the append-only source of truth. Each event is persisted with a monotonically increasing sequence number and published to both the persistent event log and the transient PubSub.

Event types persisted to the database:

| Event Type | Description |
|------------|-------------|
| `message.created` | User or assistant message added to the conversation |
| `tool.started` | Tool execution began (includes tool call metadata) |
| `tool.updated` | Incremental tool output (e.g., streaming bash output) |
| `tool.finished` | Tool execution completed with output and status |
| `approval.requested` | Operator paused for user approval (mutation or clarification) |
| `approval.resolved` | User approved or rejected the pending approval |
| `terminal.projected` | A terminal projection was created by a bash.run execution |
| `session.completed` | Session reached a terminal state |
| `skills.updated` | Attached skills were changed |

Transient event types (PubSub only, not persisted):

| Event Type | Description |
|------------|-------------|
| `message.streaming` | Partial assistant content for real-time rendering |
| `session.title_updated` | LLM-generated title was applied |
| `session.summary_updated` | LLM-generated summary was applied |

### Branch and Fork

**Branch**: Resets the current session's leaf entry pointer to a different point in the entry tree. The session ID stays the same, but future messages build from the new branch point. Previous entries beyond the branch point remain in the database but are excluded from the conversation path.

**Fork**: Creates a new independent session that copies the entry history up to the fork point. The forked session gets a new ID, appears in the session list, and records `parentSessionId` and `forkedFromEntryId` for lineage tracking.

## Pi-Agent-Core Integration

The operator uses `@mariozechner/pi-agent-core` as the LLM agent framework. The integration is in `OperatorRuntime`.

### Agent Class

Each session gets a dedicated `Agent` instance stored in a `Ref<Map<string, Agent>>`. The agent is configured with:

- `initialState.systemPrompt`: Composed from the base system prompt, attached skills, plugin surface summary, and plan mode instructions
- `initialState.model`: A `Model<Api>` from `@mariozechner/pi-ai` resolved through `OperatorModelRegistry`
- `initialState.thinkingLevel`: Configurable via `SCOUT_OPERATOR_THINKING_LEVEL` (off/minimal/low/medium/high/xhigh)
- `toolExecution: "parallel"`: Tools execute in parallel when the LLM requests multiple tool calls
- `initialState.tools`: The full tool set built by `createTools()`

### Subscribe

`agent.subscribe()` registers a callback for real-time message events:
- `message_start` / `message_update`: Throttled at 100ms, published as transient `message.streaming` events via PubSub
- `message_end`: Persisted as a `message.created` event with the final assistant content

### beforeToolCall / afterToolCall

These hooks are set on the agent instance before each prompt turn:

**beforeToolCall**: Runs synchronously before each tool execution. Handles:
1. Records tool metadata (start time, affected node IDs, input)
2. Runs plugin extension `beforeToolCall` hooks
3. Appends `tool.started` event
4. Checks if the tool is `ask_user` -- always blocks with a clarification approval
5. Checks `requiresOperatorApproval()` based on approval mode, tool type, and plugin manifest flags
6. If approval is required, appends `approval.requested` event and returns `{ block: true }`
7. Checks plan mode enforcement -- blocks mutating tools when plan mode is `plan_first`
8. Returns `undefined` to allow execution

**afterToolCall**: Runs after each tool execution completes. Handles:
1. Runs plugin extension `afterToolCall` hooks
2. Appends `tool.finished` event with output, status, summary, and timing
3. Cleans up tool metadata

## Tool Architecture

### Built-In Tools (8)

| Tool | Parameters Schema | Node Scope | Requires Approval |
|------|-------------------|------------|-------------------|
| `observe.systems` | `{ nodeIds?: string[] }` | Session scope or subset | Never |
| `observe.alerts` | `{ nodeIds?: string[] }` | Session scope or subset | Never |
| `observe.metrics` | `{ nodeIds?: string[] }` | Session scope or subset | Never |
| `observe.plugins` | `{ nodeIds?: string[], pluginId?: string }` | Session scope or subset | Never |
| `bash.run` | `{ nodeId, label, command, isMutation }` | Single node | Only when `isMutation: true` |
| `plugin.runAction` | `{ nodeId, pluginId, actionId, entityKind?, entityId?, inputJson? }` | Single node | When action has `requiresConfirmation` |
| `plugin.logs` | `{ nodeId, pluginId, streamId, entityKind?, entityId?, inputJson?, maxBatches? }` | Single node | Never |
| `ask_user` | `{ question, header, options[], multiple? }` | None | Always (clarification kind) |

### Node Scope Enforcement

Every tool enforces node scope through `requireScopedNode()`. If a tool targets a `nodeId` not in `session.selectedNodeIds`, the tool throws immediately. Observe tools default to the full session scope when `nodeIds` is omitted.

### requiresOperatorApproval

The approval decision function evaluates these rules in order:

1. If `approvalMode === "auto_approve_all"`: never require approval
2. If `approvalMode === "auto_approve_reads"`: skip approval for observe tools, `ask_user`, `plugin.logs`, and `bash.run` with `isMutation: false`
3. If `bash.run` with `isMutation: true`: require approval
4. If `plugin.runAction` and the action's manifest has `requiresConfirmation: true`: require approval
5. If the tool name matches a plugin-contributed operator tool with `requiresConfirmation: true`: require approval
6. Otherwise: no approval required

## Approval Flow

```
LLM requests tool call
    |
    v
beforeToolCall fires
    |
    +-- ask_user? --> Always block with clarification approval
    |
    +-- requiresOperatorApproval()? --> Block with mutation approval
    |
    +-- plan_first + mutating? --> Block with plan mode message
    |
    v
Tool executes normally
```

When blocked:
1. `approval.requested` event is appended (kind: `mutation` or `clarification`)
2. Session status changes to `waiting_for_user`
3. Browser receives the event via `operator.events.subscribe` stream
4. User resolves via `operator.approvals.resolve` RPC with decision `approved` or `rejected`
5. `approval.resolved` event is appended
6. Session status returns to `active`
7. The pi-agent-core Agent resumes from the blocked state

## Plan Mode Enforcement

When `session.planMode === "plan_first"`, the `beforeToolCall` hook blocks these tools:
- `bash.run` where `isMutation === true`
- `plugin.runAction` (all invocations)
- Plugin-contributed operator tools with `requiresConfirmation === true`

The block returns `{ block: true, reason: "Plan mode is active..." }` which the LLM sees as a tool error, instructing it to propose a plan instead.

Additionally, the system prompt includes an explicit instruction:
> "Plan mode is active. You MUST propose a step-by-step plan before taking any mutating action. Use observe tools freely to investigate, but do not execute bash mutations or plugin actions until the user approves your plan."

## Event Sourcing

### Append-Only Events

All session state changes are recorded as events in `operator_session_events`. Each event gets a monotonically increasing `seq` number within its session. The event payload (stored as JSON) is the source of truth; the `type` field in the row is denormalized for indexing.

### Projected Tables

Five tables are projections derived from events:

| Table | Projected From | Purpose |
|-------|---------------|---------|
| `operator_entries` | `message.created`, `tool.finished` | Conversation tree with parent chain for branch/fork traversal |
| `operator_tool_calls` | `tool.started`, `tool.updated`, `tool.finished` | Queryable tool execution records |
| `operator_approvals` | `approval.requested`, `approval.resolved` | Queryable approval state |
| `operator_terminal_projections` | `terminal.projected` | Links tool calls to terminal PTY streams |
| `operator_plan_snapshots` | Plan-related events | Step-level plan status tracking |

Event appending and projection writes happen in the same synchronous database transaction via `OperatorSessions.appendEvent`.

### Session Reconstruction

When `OperatorSessionManager.prepareRuntime` rebuilds agent state for a prompt:
1. Load the session detail (all events, entries, tool calls, approvals, projections)
2. Find the current leaf entry via `session.currentLeafEntryId`
3. Walk the parent chain from the leaf back to the root to get the ordered entry path
4. Convert each entry to a pi-agent-core `AgentMessage` (user messages, assistant messages, and tool results)
5. Hydrate `agent.state.messages` with the reconstructed conversation

## Streaming

### Transient PubSub Events

Three event types are published to the PubSub but never persisted:

- **`message.streaming`**: Partial assistant content emitted during LLM generation. Throttled at 100ms intervals. The browser uses these for real-time typing animation.
- **`session.title_updated`**: Fired after the dedicated title subagent generates a new title. The browser updates the session header immediately.
- **`session.summary_updated`**: Fired after the dedicated summary subagent generates a new summary. The browser updates the session card.

### Browser Consumption

The browser subscribes via `operator.events.subscribe` (a server-push stream RPC). The stream delivers both persisted and transient events. The client-side `OperatorSessionPanel` component:

1. Creates a `HubClient.runtime.pull` atom for the event stream
2. On each batch of events, separates transient from persistent events
3. Persistent events are reduced into `liveDetail` state via `applyOperatorEvent`
4. `message.streaming` events update `streamingContent` state for real-time rendering
5. `session.title_updated` and `session.summary_updated` events update session metadata optimistically

## Dedicated Subagents

Two fire-and-forget subagents run after each operator turn:

### Title Generation

- Triggered after the first prompt turn if the session still has a default title
- Also triggered every 10 user messages to keep the title relevant
- Uses a fresh `Agent` instance with a minimal system prompt: "Generate a concise 3-5 word title..."
- The generated title is persisted via `OperatorSessions.setTitle` and published as a transient `session.title_updated` event

### Summary Generation

- Triggered after every prompt turn
- Reads the last 10 session events for context
- Uses a fresh `Agent` instance with the prompt: "Summarize this operator session in 1-2 sentences..."
- The generated summary is persisted via `OperatorSessions.setSummary` and published as a transient `session.summary_updated` event

Both subagents run in detached fibers (`Effect.forkDetach`) so they do not block the main prompt response.

## Schema Reference

### Shared Schemas (`packages/shared/src/schemas/operator.ts`)

The operator defines a comprehensive set of Effect Schema models:

- **Session**: `OperatorSessionStatusSchema`, `OperatorApprovalModeSchema`, `OperatorSessionSummarySchema`, `OperatorSessionDetailSchema`
- **Messages**: `OperatorMessageRoleSchema`, `OperatorMessageSchema`
- **Entries**: `OperatorEntryKindSchema` (message, tool_result, branch_summary, compaction, model_change, skill_change, thinking_level_change, custom, custom_message, scope_change), `OperatorEntrySchema`
- **Tool Calls**: `OperatorToolCallStatusSchema`, `OperatorToolCallSchema`
- **Approvals**: `OperatorApprovalKindSchema` (scope_expansion, mutation, bypass_mode, clarification), `OperatorApprovalStatusSchema`, `OperatorApprovalRequestSchema`
- **Plans**: `OperatorPlanStatusSchema`, `OperatorPlanStepStatusSchema`, `OperatorPlanStepSchema`, `OperatorPlanSchema`, `OperatorPlanSnapshotSchema`
- **Terminal**: `OperatorTerminalProjectionSchema`
- **Skills/Resources/Models**: `OperatorSkillSchema`, `OperatorResourceSchema`, `OperatorModelDescriptorSchema`
- **Events**: `OperatorSessionEventSchema`
- **RPC Params**: `OperatorSessionCreateParamsSchema`, `OperatorSessionGetParamsSchema`, `OperatorPromptParamsSchema`, `OperatorApprovalResolveParamsSchema`, `OperatorSessionSetTitleParamsSchema`, `OperatorSessionSetApprovalModeParamsSchema`, `OperatorSessionSetPlanModeParamsSchema`, `OperatorSessionSetSkillsParamsSchema`, `OperatorSessionArchiveParamsSchema`, `OperatorSessionDeleteParamsSchema`, `OperatorSessionBranchParamsSchema`, `OperatorSessionForkParamsSchema`, `OperatorEventsSubscribeParamsSchema`

### RPC Methods (`ClientHubRpcs`)

17 operator RPC methods in the browser-to-hub group:

| Method | Type |
|--------|------|
| `operator.sessions.list` | Query |
| `operator.sessions.get` | Query |
| `operator.sessions.create` | Mutation |
| `operator.sessions.setTitle` | Mutation |
| `operator.sessions.setApprovalMode` | Mutation |
| `operator.sessions.setPlanMode` | Mutation |
| `operator.sessions.setSkills` | Mutation |
| `operator.sessions.archive` | Mutation |
| `operator.sessions.delete` | Mutation |
| `operator.sessions.branch` | Mutation |
| `operator.sessions.fork` | Mutation |
| `operator.prompt` | Mutation |
| `operator.approvals.resolve` | Mutation |
| `operator.skills.list` | Query |
| `operator.models.list` | Query |
| `operator.events.subscribe` | Stream |

### Database Tables (7)

| Table | Key Columns |
|-------|-------------|
| `operator_sessions` | id, title, status, selectedNodeIds, approvalMode, planMode, modelProviderId, modelId, parentSessionId, currentLeafEntryId, lastEventSeq |
| `operator_session_events` | id, sessionId, seq, at, type, payload (JSON) |
| `operator_entries` | id, sessionId, parentEntryId, sourceEventId, kind, role, data (JSON) |
| `operator_tool_calls` | id, sessionId, entryId, nodeIds, name, status, summary, input, output, startedAt, finishedAt |
| `operator_approvals` | id, sessionId, toolCallId, kind, status, reason, affectedNodeIds, requestedAt, resolvedAt |
| `operator_terminal_projections` | id, sessionId, toolCallId, nodeId, mode, streamRef |
| `operator_plan_snapshots` | id, sessionId, entryId, status, summary, data (JSON) |

## Web Component Architecture

The operator UI lives in `apps/web/src/components/operator/` with 7 component files:

| File | Role |
|------|------|
| `operator-shell.tsx` | Top-level shell that hosts the sidebar drawer and workbench page variants |
| `operator-session-panel.tsx` | Main session view: event timeline, streaming content, prompt input, metadata sidebar, keyboard shortcuts, and all mutation handlers |
| `operator-prompt-input.tsx` | Tiptap-based rich prompt editor with @mentions, /commands, image attachments, history, and footer controls (node scope, model, approval mode, plan mode) |
| `operator-event-card.tsx` | Renders individual events (messages, tool calls, approvals, projections) with Streamdown markdown rendering |
| `operator-session-meta.tsx` | Collapsible metadata panel showing session properties, node scope, skills, and model info |
| `operator-dialogs.tsx` | Modal dialogs (manage skills) |
| `operator-utils.ts` | Pure utility functions: event reduction, projection helpers, approval state maps |

### Tiptap Extensions (10 files)

The prompt editor is powered by tiptap with custom extensions in `apps/web/src/components/operator/tiptap/`:

| File | Extension |
|------|-----------|
| `node-mention-extension.ts` | Custom Mention variant for @node references with styled pills |
| `node-mention-suggestion.ts` | Suggestion provider that queries the system list for @mention autocomplete |
| `node-mention-list.tsx` | React dropdown component for node mention suggestions |
| `slash-suggestion.ts` | Suggestion provider for /slash commands (built-in + skill commands) |
| `slash-command-list.tsx` | React dropdown component for slash command suggestions |
| `keyboard-extension.ts` | Custom keyboard handler: Enter to submit, Shift+Enter for newline, Up/Down for history |
| `attachment-extension.ts` | Handles paste and drop events for image attachments |
| `types.ts` | Shared TypeScript types for mention items and slash command items |
| `index.ts` | Barrel export for all extensions |
| `prompt-input.css` | Editor styling |

## Extension Points

### Plugin Operator Surface

Plugins can extend the operator by exporting an operator surface from their package. The surface can contribute:

- **Tools** (`ScoutOperatorTool`): Custom tools with parameters schema, execute function, and `requiresConfirmation` flag. Tools receive session context and are subject to the same approval and plan mode enforcement as built-in tools.
- **Skills** (`ScoutOperatorSkillDefinition`): Skill definitions with ID, name, description, and content. Appear in the skills list with `source: "plugin"`.
- **Resources** (`OperatorResource`): Reference documents available via `OperatorResources.list()`.
- **Hooks** (`ScoutOperatorHookSet`):
  - `beforePrompt(input)`: Return additional system prompt sections. Called during `OperatorSessionManager.beforePromptSections`.
  - `beforeToolCall(input)`: Called during `beforeToolCall` hook for side effects (logging, telemetry). Cannot block execution.
  - `afterToolCall(input)`: Called after tool execution for side effects.

All plugin operator surfaces are discovered via `PluginRegistry.listOperatorPlugins()` at hub startup.

### SKILL.md Files

Custom skills can be added without modifying plugin code by placing `SKILL.md` files in directories listed in `SCOUT_OPERATOR_SKILLS_DIRS`. The discovery process:

1. Recursively walk each configured directory
2. Look for files named `SKILL.md`
3. Parse YAML frontmatter for `name` and `description`
4. Body text becomes the skill content
5. Skills are deduplicated by ID (first-discovered wins)

### Hooks

The `OperatorExtensions` service bridges plugin hooks into the operator lifecycle:

- **`beforePrompt`**: Called before each prompt turn. Collects system prompt sections from all plugins. Also injects a built-in plugin surface summary if any plugins are installed.
- **`beforeToolCall`**: Called before each tool execution. All plugin hooks run regardless of which tool is being called.
- **`afterToolCall`**: Called after each tool execution with the result and error status.

Hook inputs include an `OperatorSessionContext` with the session ID, title, status, node scope, skill attachments, approval mode, plan mode, and model selection.
