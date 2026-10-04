# Hub Services

## OVERVIEW

Services are composed via `Layer` in `apps/hub/src/app.ts`. Each service uses `Context.Service` from Effect v4.

## STRUCTURE

| Service                 | File                                     | Dependencies                                                            | Purpose                                                       |
| ----------------------- | ---------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `Database`              | `database.ts`                            | —                                                                       | SQLite via Drizzle ORM                                        |
| `MetricsIngestion`      | `metrics-ingestion.ts`                   | Database                                                                | Persist + query system/plugin metrics                         |
| `MetricsBroadcast`      | `metrics-broadcast.ts`                   | —                                                                       | PubSub for real-time metric/alert events                      |
| `Retention`             | `retention.ts`                           | Database                                                                | 30-day tiered data retention                                  |
| `AlertEngine`           | `alert-engine.ts`                        | Database, MetricsBroadcast                                              | 3-strike debounce alert evaluation                            |
| `AgentRegistry`         | (in `rpc/agent-bridge.ts`)               | Database                                                                | Agent lifecycle, typed RPC client storage                     |
| `PluginRegistry`        | `plugin-registry.ts`                     | —                                                                       | Load plugins from packages/                                   |
| `OperatorSessions`      | `operator-sessions.ts`                   | Harness, Models, Skills, Resources                                      | Session lifecycle, approvals, abort, projection, watch stream |
| `OperatorHarness`       | `operator-harness.ts`                    | Database, Ingestion, AgentRegistry, Plugins, Extensions, Skills, Models | pi-durable Harness over `operator-storage.ts` (bun:sqlite)    |
| —                       | `operator-tools.ts` / `operator-docs.ts` | —                                                                       | Tools, durable approval gate, plan mode; Scout documents      |
| `OperatorModelRegistry` | `operator-model-registry.ts`             | —                                                                       | pi-ai models with configured credentials                      |
| `OperatorSkills`        | `operator-skills.ts`                     | —                                                                       | SKILL.md loader from disk                                     |
| `OperatorExtensions`    | `operator-extensions.ts`                 | PluginRegistry                                                          | Hook system, plugin bridge                                    |

## WHERE TO LOOK

| Task                       | File                                                                 | Notes                                                                |
| -------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Add operator tool          | `operator-tools.ts` `makeOperatorExtensions()`                       | Side effects go through `gate()`; only idempotent tools rerun freely |
| Change approval logic      | `operator-tools.ts` `requiresOperatorApproval()` / `awaitDecision()` | See `docs/operator/architecture.md` "Durable Approvals"              |
| Change the wire projection | `operator-sessions.ts` `projectSession()`                            | Pure; durable view → `OperatorSessionDetail`                         |
| Change model resolution    | `operator-model-registry.ts`                                         | Reads SCOUT*OPERATOR*\* env vars and provider API keys               |
| Add skill source           | `operator-skills.ts`                                                 | Scans directories for SKILL.md                                       |
| Add extension hook         | `operator-extensions.ts`                                             | beforePrompt/beforeToolCall/afterToolCall                            |
