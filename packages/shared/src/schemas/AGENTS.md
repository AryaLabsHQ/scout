# SHARED SCHEMAS

## OVERVIEW
This directory is the canonical source for Effect Schema wire models shared across the repo: systems, metrics, alerts, management payloads, terminal messages, and low-level RPC protocol envelopes.

## STRUCTURE
```text
packages/shared/src/schemas/
├── system.ts / system-metrics.ts  # system identity and time-series payloads
├── alerts.ts                      # alert and alert-rule contracts
├── management.ts                  # plugin action/log params and management errors
├── terminal.ts                    # terminal input/output payloads
├── operator.ts                    # operator session, event, tool call, approval schemas
├── protocol.ts                    # low-level request/response/event frames
└── index.ts                       # public package barrel
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| System inventory / capabilities | `system.ts` | Core system identity and status models |
| Metric samples | `system-metrics.ts` | Time-series payloads consumed by hub and web |
| Alerts and rules | `alerts.ts` | Alert lifecycle data |
| Terminal messages | `terminal.ts` | Open/input/resize/close payloads and stream chunks |
| Generic plugin management payloads | `management.ts` | Shared plugin action/log inputs and `ManagementError` |
| Operator sessions and events | `operator.ts` | Session, entry, tool call, approval, plan snapshot schemas |
| Raw protocol frames | `protocol.ts` | Lower-level request/response/event schema set |

## CONVENTIONS
- Export every public schema from `index.ts`.
- Prefer schema-derived types over parallel hand-written interfaces.
- Keep schema names aligned with the RPC groups that consume them.
- When a schema feeds both REST bootstrap and RPC traffic, keep the shared model here and let apps handle serialization details separately.

## ANTI-PATTERNS
- Do not hide a new cross-runtime contract in an app package.
- Do not update a schema without updating the RPCs or consumers that depend on it.
- Do not create one-off TS aliases when the schema itself can be imported.
