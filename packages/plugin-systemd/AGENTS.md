# SYSTEMD PLUGIN

## OVERVIEW
`packages/plugin-systemd` is the systemd integration package. It defines the plugin manifest, contract ids, runtime adapters, and the main implementation for service inspection and management actions.

## STRUCTURE
```text
packages/plugin-systemd/src/
├── contracts.ts   # ids, capabilities, action/stream/entity definitions
├── manifest.ts    # published plugin metadata and permissions
├── systemd.ts     # core systemd implementation
├── agent.ts       # agent runtime adapter
├── hub.ts / web.ts
└── index.ts
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Public plugin metadata | `src/manifest.ts` | Canonical plugin identity, permissions, and runtimes |
| Shared ids and schema contracts | `src/contracts.ts` | Central source for capabilities, actions, streams |
| Main systemd implementation | `src/systemd.ts` | Capability detection, collection, and action logic live here |
| Runtime entry points | `src/agent.ts`, `src/hub.ts`, `src/web.ts` | Package surface consumed by Scout runtimes |

## CONVENTIONS
- Keep `manifest.ts` and `contracts.ts` in sync.
- Route package exports through `src/index.ts`. The `./contracts` subpath exports `contracts.ts` alone (ids and schemas only, no Node imports) for the web dashboard.
- Keep runtime adapters thin and move core behavior into `src/systemd.ts`.
- Add new service-management actions or streams through `contracts.ts` first.
- Never escalate privileges: reads run unprivileged, state changes run `systemctl --no-ask-password` and a polkit/permission refusal surfaces as a `permission-denied` execution error.

## ANTI-PATTERNS
- Do not duplicate systemd ids or permission names outside `contracts.ts` / `manifest.ts`.
- Do not spread core service-management logic across the adapter files.
- Do not let consumers depend on internal helper shapes instead of package exports.
