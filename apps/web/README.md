# `@scout/web`

`apps/web` is the Scout dashboard built with TanStack Start. It fetches initial data from the hub over HTTP during SSR, then switches to a shared AtomRpc client for live queries, mutations, and streams in the browser.

## Responsibilities

- Render the main Scout UI for systems, alerts, terminal access, settings, and plugin screens
- Bootstrap initial page data with `createServerFn` wrappers around hub HTTP endpoints
- Maintain a shared browser RPC runtime via `HubClient`
- Coordinate cross-page UI state such as the terminal panel and command palette

## Configuration

Common environment variable:
- `SCOUT_HUB_URL`

The hub RPC browser protocol is wired in [`src/rpc/protocol.ts`](./src/rpc/protocol.ts).

## Key Entry Points

- [`src/routes/__root.tsx`](./src/routes/__root.tsx): app shell, root loader, and hub URL injection
- [`src/providers/atom-provider.tsx`](./src/providers/atom-provider.tsx): Atom registry, runtime pinning, and SSR seeding
- [`src/rpc/client.ts`](./src/rpc/client.ts): shared browser RPC client
- [`src/server/`](./src/server): SSR/bootstrap fetch helpers
- [`src/routes/`](./src/routes): page routes and route-level loaders

## Commands

```bash
# Run the Vite dev server
bun run dev

# Run against the test env file
bun run dev:test

# Build
bun run build

# Preview the production build
bun run preview

# Typecheck
bun run typecheck
```

## Related Packages

- [`../../packages/shared/README.md`](../../packages/shared/README.md): shared schemas and RPC groups
- [`../../packages/plugin-sdk/README.md`](../../packages/plugin-sdk/README.md): plugin web surfaces and screen contracts

## More Detail

Implementation-oriented guidance lives in [`AGENTS.md`](./AGENTS.md) and [`src/routes/AGENTS.md`](./src/routes/AGENTS.md).
