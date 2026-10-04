# WEB APP

## OVERVIEW
`apps/web` is a TanStack Start dashboard backed by Effect AtomRpc. SSR loaders fetch initial hub data over HTTP, then live queries, mutations, and streams flow through a shared `HubClient` runtime.

## STRUCTURE
```text
apps/web/
├── src/routes/       # TanStack route files and page-level loaders
├── src/server/       # `createServerFn` wrappers around hub HTTP endpoints
├── src/rpc/          # browser RPC protocol + AtomRpc client
├── src/providers/    # Atom registry/runtime, terminal panel, command palette
├── src/components/   # app-specific UI, terminal, charts, shadcn-style primitives
└── src/hooks/        # browser-side behavior helpers
├── src/components/operator/  # operator chat UI (7 files + tiptap/)
├── src/providers/operator-provider.tsx  # drawer state, active session
├── src/routes/operator.tsx              # session list page
├── src/routes/operator_.$sessionId.tsx  # session detail page
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add a page or route loader | `src/routes` | Route filenames map directly to TanStack route ids |
| Bootstrap data from the hub | `src/server/*` | These are SSR/server-function entry points |
| Live queries, mutations, or streams | `src/rpc/client.ts`, `src/rpc/protocol.ts` | `HubClient` is the canonical browser RPC client |
| Seed or pin atom state | `src/providers/atom-provider.tsx` | Keeps the runtime alive and injects SSR-fetched values |
| Shared UI shell / terminal panel behavior | `src/routes/__root.tsx`, `src/components/terminal` | Root route owns the app chrome |
| Operator chat UI | `src/components/operator/`, `src/components/operator/AGENTS.md` | 7 component files + 10 tiptap extensions |
| Operator session routing | `src/routes/operator.tsx`, `src/routes/operator_.$sessionId.tsx` | List view + detail view as flat routes |

## CONVENTIONS
- Prefer `src/server/*` for initial page data and `HubClient` atoms for ongoing live state.
- Server functions call the hub only through `hubFetch` (`src/server/hub.ts`), which forwards the Cloudflare Access credential; a raw `fetch` to the hub is rejected with 401.
- The browser connects to `/ws/rpc` same-origin; never embed the hub's internal URL in client code.
- `AtomProvider` must stay high in the tree so the HubClient runtime is pinned before consumers mount.
- Shared contract types come from `@scout/shared`; the web app should not invent parallel interfaces for systems, alerts, terminal output, or plugin actions.
- Large route files are normal here; route-level state belongs with the route unless it becomes cross-page UI state.

## ANTI-PATTERNS
- Do not fetch the hub directly from random components if an existing server function or HubClient query already covers the case.
- Do not create a second Atom registry/runtime outside `AtomProvider`.
- Do not move protocol payload definitions out of `packages/shared`.
