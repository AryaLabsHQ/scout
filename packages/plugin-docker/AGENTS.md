# DOCKER PLUGIN

## OVERVIEW

`packages/plugin-docker` is the Docker integration package. It defines the Docker plugin manifest, shared contract ids, runtime adapters, and the main implementation for Docker capability detection, collection, actions, and log streams.

## STRUCTURE

```text
packages/plugin-docker/src/
├── contracts.ts   # ids, capabilities, action/stream/entity definitions
├── manifest.ts    # published plugin metadata and permissions
├── docker.ts      # core Docker implementation
├── agent.ts       # agent runtime adapter
├── hub.ts / web.ts
└── index.ts
```

## WHERE TO LOOK

| Task                            | Location                                   | Notes                                                          |
| ------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| Public plugin metadata          | `src/manifest.ts`                          | Canonical plugin id, permissions, runtimes, capabilities       |
| Shared ids and schema contracts | `src/contracts.ts`                         | Keep action/stream/entity names centralized here               |
| Main Docker implementation      | `src/docker.ts`                            | Large file; capability, collection, and action logic live here |
| Runtime entry points            | `src/agent.ts`, `src/hub.ts`, `src/web.ts` | Package surface consumed by Scout runtimes                     |

## CONVENTIONS

- Keep manifest metadata in sync with `contracts.ts`.
- Export package surface through `src/index.ts`.
- Agent, hub, and web adapters should stay thin over the shared Docker implementation and manifest data.
- Add new Docker-facing actions or streams through `contracts.ts` first so the manifest stays honest.

## ANTI-PATTERNS

- Do not hardcode Docker plugin ids or permission names outside `contracts.ts` / `manifest.ts`.
- Do not add runtime-specific schema drift between `agent.ts`, `hub.ts`, and `web.ts`.
- Do not split contract names across multiple files when one source of truth already exists.
