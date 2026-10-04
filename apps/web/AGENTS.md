# WEB APP

## OVERVIEW
`apps/web` is a TanStack Start dashboard backed by Effect AtomRpc. SSR loaders fetch initial hub data over HTTP, then live queries, mutations, and streams flow through a shared `HubClient` runtime.

The UI is dark only: a black background, a neutral gray scale, 1px borders, Geist Sans and Geist Mono, and colour reserved for status (green / amber / red dots). A top bar carries all navigation; there is no sidebar.

## STRUCTURE
```text
apps/web/
├── src/routes/       # TanStack route files and page-level loaders
├── src/server/       # `createServerFn` wrappers around hub HTTP endpoints
├── src/rpc/          # browser RPC protocol + AtomRpc client
├── src/providers/    # Atom registry/runtime, confirm dialog, terminal panel, command palette, operator drawer
├── src/components/   # app-specific UI, shell, terminal, charts, shadcn-style primitives
├── src/components/shell/     # top bar (machine switcher, nav, live indicator) and session banner
├── src/components/operator/  # operator chat UI (7 files + tiptap/)
├── src/hooks/        # pins, plugin data queries, unit actions, refresh intervals
└── src/lib/          # connection state, health thresholds, systemd/k8s/edge entity helpers, formatting
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add a page or route loader | `src/routes` | Route filenames map directly to TanStack route ids |
| Bootstrap data from the hub | `src/server/*` | These are SSR/server-function entry points |
| Live queries, mutations, or streams | `src/rpc/client.ts`, `src/rpc/protocol.ts` | `HubClient` is the canonical browser RPC client |
| Socket state and the expired-session banner | `src/lib/hub-connection.ts`, `src/rpc/protocol.ts`, `src/components/shell/connection.tsx` | The protocol reports open/close and any `Unauthorized` exit |
| Seed or pin atom state | `src/providers/atom-provider.tsx` | Keeps the runtime alive and injects SSR-fetched values |
| App chrome, terminal panel | `src/routes/__root.tsx`, `src/components/shell`, `src/components/terminal` | Root route owns the top bar, banner, and terminal dock |
| Confirm before a state change | `src/providers/confirm-provider.tsx` | `useConfirm()`; every mutation goes through it |
| Plugin data (systemd units, k8s workloads, events) | `src/hooks/use-plugin-data.ts` | `plugins.entities` / `plugins.metrics` / `plugins.events`, refreshed every 15 s |
| Generic plugin screens | `src/lib/plugin-ui/runtime.tsx` | json-render catalog for plugins without a dedicated page |
| Operator chat UI | `src/components/operator/`, `src/components/operator/AGENTS.md` | 7 component files + 10 tiptap extensions |

## CONVENTIONS
- Prefer `src/server/*` for initial page data and `HubClient` atoms for ongoing live state.
- Server functions call the hub only through `hubFetch` (`src/server/hub.ts`), which forwards the Cloudflare Access credential; a raw `fetch` to the hub is rejected with 401.
- The browser connects to `/ws/rpc` same-origin; never embed the hub's internal URL in client code.
- `AtomProvider` must stay high in the tree so the HubClient runtime is pinned before consumers mount.
- Shared contract types come from `@scout/shared`; plugin ids, kinds, actions, and streams come from each plugin's `contracts` subpath (`@scout/plugin-systemd/contracts`, `@scout/plugin-k8s/contracts`, `@scout/plugin-edge/contracts`).
- systemd units come from two managers. The entity kind (`systemd.unit` vs `systemd.user-unit`) carries the scope; unit pages take `?scope=user`, actions pass it to `useUnitAction`, and user-unit pins are stored as `user:<id>` (`pinKey`).
- Overview sections backed by optional collectors (Ingress from the edge plugin, Backups & timers from systemd timers) render nothing until their data exists.
- Every state-changing action asks `useConfirm()` first, naming the action, its target, and the machine, and showing the exact command when there is one. Read-only actions (reading a unit file) run without a confirm.
- Read query results with `lastValue()` (`src/lib/async-result.ts`) so a failed refresh, such as after the Access session expires, keeps the last good data on screen.
- Colour only for status: `StatusDot` and the `ok` / `warn` / `err` / `off` tokens in `styles.css`. A health value turns amber or red only when it breaches an enabled alert rule (`src/lib/health.ts`).
- Pinned units live in this browser's `localStorage` (`usePins`, one list per system); the hub knows nothing about them.
- Relative future times ("next in 19h") use `TimeUntil` from the same module as `TimeAgo`.
- Relative times use `TimeAgo`, which tolerates the server render and hydration straddling a minute.
- Large route files are normal here; route-level state belongs with the route unless it becomes cross-page UI state.

## ANTI-PATTERNS
- Do not fetch the hub directly from random components if an existing server function or HubClient query already covers the case.
- Do not create a second Atom registry/runtime outside `AtomProvider`.
- Do not move protocol payload definitions out of `packages/shared`.
- Do not infer connection state from cached query results; read `useHubConnection()`.
- Do not call `window.confirm` or run a mutation without the confirm dialog.
