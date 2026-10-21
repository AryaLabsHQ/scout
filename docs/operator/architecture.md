# Scout Operator -- Architecture

The operator runs on [`@earendil-works/pi-durable`](https://github.com/earendil-works/pi/tree/main/packages/durable):
a durable agent harness where conversations, model turns, tool calls, and application documents are committed
to storage before anything is shown. If the hub dies mid-turn, reopening the storage continues the work. Scout
wraps the Harness in Effect services; pi-durable stays behind them.

## Service Graph

All services are composed in `apps/hub/src/app.ts`.

```
OperatorSessions                 session lifecycle, projection to the wire contract, watch stream
  +-- OperatorHarness            Harness.open/close (scoped), resume(), Scout extensions
  |     +-- Database, MetricsIngestion, AgentRegistry, PluginRegistry   (tool dependencies)
  |     +-- OperatorExtensions   plugin hooks + prompt sections
  |     +-- OperatorSkills       SKILL.md loader
  |     +-- OperatorModelRegistry
  +-- OperatorModelRegistry      pi-ai Models, available models, default model, thinking level
  +-- OperatorSkills
  +-- OperatorResources
```

| File                         | Role                                                                                                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operator-storage.ts`        | `bun:sqlite` adapter for pi-durable's async `SqliteDatabase` facade; proven by pi-durable's storage conformance suite (`test/services/operator-storage.test.ts`)                                                                                                                    |
| `operator-harness.ts`        | `OperatorHarness` service: opens the Harness over `SCOUT_OPERATOR_DB_PATH` (default `scout-operator.db` next to `SCOUT_DB_PATH`), installs the extensions, calls `resume()`, closes on scope release. `durable()` bridges Effect fiber interruption to a Chord context abort signal |
| `operator-docs.ts`           | Scout's durable documents: `scout.operator.sessions` (session metadata), `scout.operator.approvals` (approval requests and decisions), and `scout.operator.input-requests` (retry-key hashes)                                                                                       |
| `operator-tools.ts`          | Tools, approval gate, execution guard, prompt sections, plugin hooks, plan-mode extension                                                                                                                                                                                           |
| `operator-sessions.ts`       | `OperatorSessions` service and the pure projection from durable state to `OperatorSessionDetail`                                                                                                                                                                                    |
| `operator-model-registry.ts` | pi-ai `builtinModels()`; lists models whose provider has credentials                                                                                                                                                                                                                |
| `operator-faux-provider.ts`  | Scripted local model for smoke tests (`SCOUT_OPERATOR_MODEL_PROVIDER=faux`)                                                                                                                                                                                                         |

## Storage

The operator owns a separate SQLite file. pi-durable creates and migrates its own schema there; Scout's
Drizzle schema (`apps/hub/drizzle/schema.ts`) has no operator tables. One hub process owns the file at a time
(pi-durable has no cross-process locking).

`node:sqlite` also works under Bun 1.4.2 and passes the same conformance suite; Scout uses the `bun:sqlite`
adapter because it is Bun's first-class driver.

## Sessions

A Scout session is one ownerless pi-durable conversation. Its id is the conversation id. Scout metadata (title,
node scope, skills, approval mode, plan mode, model, archived flag, fork lineage) lives in the session-scoped
`scout.operator.sessions` document, keyed by conversation id.

| Operation | pi-durable mechanism                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| create    | `createConversation` with the agent's model and thinking level; metadata written in the same commit                        |
| prompt    | `conversation.submit({ type: "input", requestId, whenBusy: "followUp" })`; a busy session queues the input                 |
| abort     | `conversation.abort()`, then pending approvals become `canceled`                                                           |
| fork      | `conversation.fork(entryId)`: the fork sees the parent's transcript through that entry; metadata copied in the same commit |
| plan mode | `configure()` adds or clears the `scout-plan` extension, in the same commit as the metadata change                         |
| delete    | abort, then remove the metadata entry. The transcript stays in storage, unlisted (pi-durable has no conversation deletion) |

There is no in-session "branch": forking replaces it.

## Native input and recovery

`operator.prompt` accepts text plus ordered `{ mimeType, data }` images (raw canonical base64). The hub validates PNG/JPEG/WebP signature, container structure, dimensions, animation flags and byte limits before `conversation.submit()` receives native text/image content arrays. The `image-size` parser reads metadata before pixel allocation; admission then fully decodes PNG/JPEG/WebP through the pinned ImageMagick WASM decoder, rejecting codec errors and recovery warnings. Invalid compressed pixels fail before request-key reservation or native submission. The original compressed bytes remain unchanged.

Byte/pixel limits and WebP canvas/frame agreement bound the input before decoding. The decoder also limits its pixel cache to 384 MiB, any single allocation to 256 MiB, profiles to 2 MiB, and internal image lists to four, with disk caching disabled. Images decode serially under the admission semaphore. The compiled Bun hub embeds the decoder WASM asset and needs no native codec installation. Streaming projection never decodes pixels; it reuses a harness-scoped cache of metadata for up to 2048 immutable entries, containing no image bytes.

The model is resolved from the conversation's actual agent. Its input modalities and stricter input limits constrain admission; existing active context and queued images count toward a model's per-request limit. Input admissions are serialized so concurrent peers cannot bypass those counts.

The defaults live in shared `OPERATOR_IMAGE_LIMITS`: four static images, 2 MiB each, 4 MiB combined decoded, 6 MiB serialized, 20 MP each. Model resize dimensions/encoded-byte bounds are treated as rejection bounds, preserving byte identity rather than resampling. Provider serialization and subsequent tool outputs can differ from the admission context estimate; provider errors still appear in the durable timeline.

Native `pi.inbox` and `pi.user` records contain the image bytes. A conversation-scoped `scout.operator.input-requests` document reserves a SHA-256 hash for each request ID before native admission. A crash between reservation and admission leaves the original envelope retryable; native admission owns exactly-once deduplication. Changed content under a reserved key fails explicitly. Forks inherit native entries through their fork point and start with an empty retry-key document. Session deletion removes metadata only; transcript/image storage persists.

The web composer keeps the draft and immutable pending envelope in IndexedDB under the session ID. It persists before sending and retains the same ID/bytes after uncertain responses. Edits create distinct revisions, so acknowledging an older attempt cannot clear new content. Pending bytes are stored once when the draft still equals the attempt; acknowledgement removes that pending copy. Storage failures are surfaced separately from submission failures and preserve in-memory content. There is no service worker, upload store, or alternate RPC transport.

## Tools

| Tool                                                                      | Replay after restart                     | Gate                                                                        |
| ------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| `observe_systems`, `observe_alerts`, `observe_metrics`, `observe_plugins` | rerun (idempotent reads)                 | none                                                                        |
| `plugin_logs`                                                             | rerun (bounded read)                     | none                                                                        |
| `bash_run`                                                                | resumes approval wait; never re-executes | approval when `isMutation`, execution guard always                          |
| `plugin_run_action`                                                       | resumes approval wait; never re-executes | approval when the action has `requiresConfirmation`, execution guard always |
| plugin operator tools                                                     | resumes approval wait; never re-executes | approval unless `requiresConfirmation: false`, execution guard always       |
| `ask_user`                                                                | resumes wait                             | always waits for an answer                                                  |

Tool names use underscores: provider tool-name rules (`^[a-zA-Z0-9_-]+$`) reject dots.

Every tool enforces node scope against the session metadata.

## Durable Approvals

pi-durable hooks (`beforeTool`) can block a call but cannot suspend it durably: they run before the call's
intent is stored. Approvals therefore live inside the tool's `execute()`:

1. **Record.** The tool commits a request into `scout.operator.approvals`, keyed by its tool task id. If a
   record already exists (a rerun), it is reused.
2. **Wait.** If the record is pending, the tool watches the document until a decision lands. The session shows
   `waiting_for_user`.
3. **Decide.** `operator.approvals.resolve` commits `approved`/`rejected`, the optional `answer` (clarifications),
   and the `actor`: the email (else subject) of the identity `ClientAuthMiddleware` verified for the call.
4. **Claim.** An approved (or ungated) side-effecting call claims its single execution with a durable task memo
   (`scout.execution`) holding a fresh token, then executes.

These tools are declared `replay: "safe"`. pi-durable reruns an interrupted `replay: "safe"` call on reopen and
reports any other interrupted call to the model as an `interrupted` error. Scout's tools are safe to rerun because
the rerun goes through the same steps:

- Restart while waiting: the rerun finds the pending record and resumes waiting. Approving later executes once.
- Restart after a decision, before the claim: the rerun proceeds with the stored decision and executes once.
- Restart after the claim, during execution: the memo holds the first attempt's token, so the rerun reports
  "interrupted, may have partially run, not executed again" to the model. Execution is at most once.

Rejection returns an error result telling the model not to retry. Abort cancels pending approvals.

`test/services/operator-sessions.test.ts` covers each case with pi-ai's faux provider, including closing and
reopening the Harness over the same file.

## Plan Mode

The `scout-plan` extension adds a `plan_mode` prompt section and a `beforeTool` hook that blocks
`plugin_run_action`, mutating `bash_run`, and mutating plugin tools. It is selected per conversation with
`configure({ extensions: { add: [plan] } })`; leaving plan mode clears the selection back to the host default.
The model sees each switch as a system prompt change in its transcript.

## System Prompt

The `scout` extension renders three sections before each request: the base prompt plus node scope and tool
guidance, the attached skills (`Skill: <name>` + SKILL.md body), and plugin `beforePrompt` sections. pi-durable
sends only changed sections again, which keeps provider prompt caches warm.

## Models

`OperatorModelRegistry` registers every pi-ai built-in provider. Providers read credentials from the environment
(e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). `operator.models.list` returns models whose provider is configured.
`SCOUT_OPERATOR_MODEL_PROVIDER` / `SCOUT_OPERATOR_MODEL_ID` select the default for new sessions;
`SCOUT_OPERATOR_THINKING_LEVEL` and `SCOUT_OPERATOR_SYSTEM_PROMPT` apply to all sessions. With no configured
provider the hub starts, and session creation fails with `operator-model-missing`.

## Wire Contract and Streaming

`packages/shared/src/schemas/operator.ts` defines the browser contract. `OperatorSessionDetail` is a projection
of durable state:

- `timeline`: user messages, assistant answers (the in-flight partial from `pi.live` as `streaming: true`), and
  tool calls with status, output, approval id, and raw PTY chunks for `bash_run` (`terminal`).
- `approvals`: the session's approval records.
- `session.status`: `archived`, else `waiting_for_user` with a pending approval, else `running` while a run is
  live, else `failed` if the last answer errored, else `idle`.

User timeline items contain image indexes, MIME types, dimensions and decoded byte counts; `queuedImages` counts queued native blocks. Base64 never enters `get`/`watch` projections. `operator.images.get({ sessionId, entryId, imageIndex })` reads the native entry lazily through the conversation's fork-aware history bounds, rejecting foreign sessions, entries past the fork point and invalid indexes.

`operator.sessions.watch` streams the full detail: one snapshot on subscribe, then one per durable change of the
conversation view, the approvals document, or the session metadata, coalesced at 50 ms with a sliding buffer of
one. pi-durable commits partial answers and tool output at most every 100 ms.

| RPC                                                                                                                                 | Kind     |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `operator.sessions.list` / `get`                                                                                                    | Query    |
| `operator.sessions.create` / `fork` / `setTitle` / `setApprovalMode` / `setPlanMode` / `setSkills` / `archive` / `delete` / `abort` | Mutation |
| `operator.prompt` / `operator.approvals.resolve`                                                                                    | Mutation |
| `operator.images.get` / `operator.skills.list` / `operator.models.list`                                                             | Query    |
| `operator.sessions.watch`                                                                                                           | Stream   |

## Access and Audit

Operator RPCs are part of `ClientHubRpcs`, so every call runs behind `ClientAuthMiddleware` (see
`apps/hub/src/rpc/auth.ts` and `docs/architecture.md`): the Cloudflare Access JWT on the `/ws/rpc` upgrade is
re-verified per RPC and the identity is provided as `CurrentIdentity`.

- Read-only operator RPCs (`operator.sessions.list` / `get`, `operator.skills.list`, `operator.models.list`,
  `operator.sessions.watch`, `operator.images.get`) are in `UNAUDITED_RPCS`. Every other operator RPC (create, prompt, abort, fork,
  approvals, mode and skill changes, archive, delete) is audit-logged with the actor and identifier fields
  (`sessionId`, `approvalId`, `decision`, ...); prompt text, answers and image bytes are never logged.
- Approval decisions store the actor durably in `scout.operator.approvals` and show it in the UI.
- `operator.sessions.watch` is a stream RPC: when the caller's Access JWT expires it fails with `Unauthorized`
  ("Cloudflare Access session expired"), and its view subscriptions are released. The browser reconnects with a
  fresh credential. Durable work (runs, approval waits) is unaffected.
- With `SCOUT_AUTH=disabled` (loopback only) the actor is the local development identity.

`test/routes/operator-rpc-auth.test.ts` covers the actor and the watch expiry over a real server with a test
JWKS.

## Limits

- The timeline shows the active transcript; entries before a compaction are summarized away from it.
- Deleted sessions stay in the operator SQLite file.
- No LLM-generated titles or summaries; the UI titles a session from its first prompt.

## Extension Points

Plugins can export an operator surface (`packages/plugin-sdk/src/operator.ts`):

- **Tools** (`ScoutOperatorTool`): TypeBox parameters, `execute(params, { session, toolCallId, signal, output })`
  returning `{ text?, details?, isError? }`. Mutating unless `requiresConfirmation: false`.
- **Skills** and **Resources**.
- **Hooks**: `beforePrompt` (prompt section), `beforeToolCall` / `afterToolCall` (observation only; failures are
  ignored).

SKILL.md files in `SCOUT_OPERATOR_SKILLS_DIRS` are discovered at startup (YAML frontmatter `name`,
`description`; body is the content).
