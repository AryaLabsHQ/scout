# PLUGIN SDK

## OVERVIEW
`packages/plugin-sdk` defines the shared plugin model: manifests, runtime interfaces, loader behavior, execution helpers, and schema-backed plugin contracts consumed by both the hub and the concrete plugin packages.

## STRUCTURE
```text
packages/plugin-sdk/
├── src/runtime.ts    # plugin interfaces and `define*` helpers
├── src/schemas.ts    # plugin-facing schemas and manifest/contracts
├── src/loader.ts     # dynamic package loading
├── src/execution.ts  # execution helpers
└── test/             # loader, execution, schema tests and fixtures
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add a manifest/runtime helper | `src/runtime.ts` | `definePluginManifest` and runtime interfaces live here |
| Change plugin contract schemas | `src/schemas.ts` | Exported publicly as `@scout/plugin-sdk/schemas` |
| Change plugin discovery/loading | `src/loader.ts` | Used by hub and agent plugin registries |
| Validate plugin behavior | `test/`, `test/fixtures/valid-plugin` | Fixture package shows the expected entrypoint shape |

## CONVENTIONS
- Concrete plugin packages should expose `manifest`, and optional `agent` / `hub` / `web` runtimes using the helpers from this package.
- Keep the SDK free of app-specific behavior.
- Prefer updating the shared SDK surface over adding ad-hoc plugin conventions in consumers.

## ANTI-PATTERNS
- Do not let plugin packages invent their own manifest shape.
- Do not make loaders depend on hub or agent internals.
- Do not add new public exports without updating the package barrel.
