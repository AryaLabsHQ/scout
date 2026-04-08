# `@scout/plugin-sdk`

`packages/plugin-sdk` defines Scout's plugin model. It provides manifest schemas, runtime interfaces, dynamic loading, and guarded execution helpers used by the hub, the agent, and concrete plugin packages.

## Responsibilities

- Define plugin manifests and runtime interfaces for `agent`, `hub`, and `web`
- Validate plugin-facing schemas for capabilities, entities, metrics, actions, streams, alerts, and UI screens
- Discover plugin packages from a directory at runtime
- Enforce permission checks, target-kind checks, and schema encode/decode during action and stream execution

## Key Entry Points

- [`src/runtime.ts`](./src/runtime.ts): runtime interfaces and `define*` helpers
- [`src/schemas.ts`](./src/schemas.ts): schema-backed plugin contract model
- [`src/loader.ts`](./src/loader.ts): plugin discovery and manifest validation
- [`src/execution.ts`](./src/execution.ts): guarded action and stream execution
- [`test/fixtures/valid-plugin`](./test/fixtures/valid-plugin): example plugin shape used in tests

## Commands

```bash
# Typecheck
bun run typecheck

# Run tests
bun run test
```

## How It Fits

Concrete plugin packages depend on this SDK for their public contract shape, while the agent and hub depend on it for dynamic loading and execution.

## More Detail

Canonical plugin authoring guidance lives in [`../../docs/plugins/authoring.md`](../../docs/plugins/authoring.md).

Operator-specific guidance lives in [`../../docs/plugins/operator.md`](../../docs/plugins/operator.md).

Implementation-oriented package guidance lives in [`AGENTS.md`](./AGENTS.md).
