# KUBERNETES PLUGIN

## OVERVIEW
`packages/plugin-k8s` is the Kubernetes integration package. It exposes the plugin manifest, K8s contract ids, runtime adapters, and the large implementation that talks to cluster state and management actions.

## STRUCTURE
```text
packages/plugin-k8s/src/
├── contracts.ts   # ids, capabilities, action/stream/entity definitions
├── manifest.ts    # published plugin metadata and permissions
├── k8s.ts         # core Kubernetes implementation
├── agent.ts       # agent runtime adapter
├── hub.ts / web.ts
└── index.ts
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Public plugin metadata | `src/manifest.ts` | Permissions include K8s API and spawned process access |
| Shared ids and schema contracts | `src/contracts.ts` | Central source for capabilities, metrics, actions, streams |
| Main K8s implementation | `src/k8s.ts` | Largest file in the repo; inspect before refactoring |
| Runtime entry points | `src/agent.ts`, `src/hub.ts`, `src/web.ts` | Package surface consumed by Scout runtimes |

## CONVENTIONS
- Keep the manifest aligned with `contracts.ts`.
- Export package entrypoints through `src/index.ts`.
- Concentrate K8s behavior in `src/k8s.ts`; keep runtime adapters thin.
- Add new cluster-facing action or stream names in `contracts.ts` before touching adapters or UI consumers.

## ANTI-PATTERNS
- Do not duplicate K8s action or entity ids outside `contracts.ts`.
- Do not hide cluster-specific assumptions in runtime adapter files.
- Do not let package consumers bypass the manifest/contracts surface.
