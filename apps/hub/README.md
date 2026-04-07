# `@scout/hub`

`apps/hub` is Scout's control plane. It ingests reports from agents, stores system and plugin state in SQLite, evaluates alerts, serves bootstrap HTTP endpoints, and hosts the browser and agent RPC layers.

## Responsibilities

- Persist systems, metrics, plugin entities, plugin events, and alerts with Drizzle + SQLite
- Accept agent reports and plugin collections over RPC
- Expose read-oriented REST endpoints for health checks and SSR bootstrap
- Expose browser and agent WebSocket RPC endpoints for live control and subscriptions
- Run retention and downsampling jobs in the background

## Configuration

Common environment variables:
- `SCOUT_DB_PATH`
- `SCOUT_PORT`
- `SCOUT_TOKEN`
- `SCOUT_PLUGIN_DIR`

Database migration config lives in [`drizzle.config.ts`](./drizzle.config.ts), and the main layer graph lives in [`src/app.ts`](./src/app.ts).

## Key Entry Points

- [`src/main.ts`](./src/main.ts): server startup, logging, routes, and retention fiber
- [`src/app.ts`](./src/app.ts): service layer composition
- [`src/routes.ts`](./src/routes.ts): REST endpoints used for health and bootstrap reads
- [`src/rpc/server.ts`](./src/rpc/server.ts): browser and agent RPC server wiring
- [`src/services/metrics-ingestion.ts`](./src/services/metrics-ingestion.ts): ingestion and historical query path
- [`drizzle/schema.ts`](./drizzle/schema.ts): SQLite schema

## Commands

```bash
# Run in dev mode
bun run dev

# Run against the test env file after pushing schema
bun run dev:test

# Build the compiled hub binary
bun run build

# Typecheck
bun run typecheck

# Run tests
bun run test

# Database workflow
bun run db:generate
bun run db:migrate
bun run db:push
```

## Related Packages

- [`../../packages/shared/README.md`](../../packages/shared/README.md): shared schemas and RPC groups
- [`../../packages/plugin-sdk/README.md`](../../packages/plugin-sdk/README.md): plugin loading and runtime contracts

## More Detail

Implementation-oriented guidance lives in [`AGENTS.md`](./AGENTS.md).
