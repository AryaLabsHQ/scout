# Hub Services

## OVERVIEW
Services are composed via `Layer` in `apps/hub/src/app.ts`. Each service uses `ServiceMap.Service` from Effect v4.

## STRUCTURE
| Service | File | Dependencies | Purpose |
|---------|------|-------------|---------|
| `Database` | `database.ts` | — | SQLite via Drizzle ORM |
| `MetricsIngestion` | `metrics-ingestion.ts` | Database | Persist + query system/plugin metrics |
| `MetricsBroadcast` | `metrics-broadcast.ts` | — | PubSub for real-time metric/alert events |
| `Retention` | `retention.ts` | Database | 30-day tiered data retention |
| `AlertEngine` | `alert-engine.ts` | Database, MetricsBroadcast | 3-strike debounce alert evaluation |
| `AgentRegistry` | (in `rpc/agent-bridge.ts`) | Database | Agent lifecycle, typed RPC client storage |
| `PluginRegistry` | `plugin-registry.ts` | — | Load plugins from packages/ |
| `OperatorRuntime` | `operator-runtime.ts` | All below | Pi-agent-core loop, 8 tools, approval hooks |
| `OperatorSessionManager` | `operator-session-manager.ts` | Sessions, Skills, Models, Extensions | Lifecycle, branch/fork, prepareRuntime |
| `OperatorSessions` | `operator-sessions.ts` | Database | Event-sourced persistence, PubSub |
| `OperatorModelRegistry` | `operator-model-registry.ts` | — | Pi-ai model/provider resolution |
| `OperatorSkills` | `operator-skills.ts` | — | SKILL.md loader from disk |
| `OperatorExtensions` | `operator-extensions.ts` | PluginRegistry | Hook system, plugin bridge |

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Add operator tool | `operator-runtime.ts` `createTools()` | Follow existing tool pattern |
| Change approval logic | `operator-runtime.ts` `requiresOperatorApproval()` | Checks approval mode + tool type |
| Add session event type | `operator-sessions.ts` `appendEvent()` | Handle in event-to-session-update switch |
| Change model resolution | `operator-model-registry.ts` | Reads SCOUT_OPERATOR_* env vars |
| Add skill source | `operator-skills.ts` | Scans directories for SKILL.md |
| Add extension hook | `operator-extensions.ts` | beforePrompt/beforeToolCall/afterToolCall |
