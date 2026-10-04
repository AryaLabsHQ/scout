# WEB ROUTES

## OVERVIEW
Route files here define page boundaries, page-level loaders, and most dashboard composition. `__root.tsx` owns the shell; other files map 1:1 to concrete pages and detail views. Machine pages live under `/systems/$systemId`; Alerts, Operator, Terminal, and Settings are global.

## STRUCTURE
```text
apps/web/src/routes/
├── __root.tsx                                   # shell: top bar, session banner, terminal dock, seeded loaders
├── index.tsx                                    # `/`: redirects to the only machine; fleet list with 2+
├── systems.$systemId.tsx                        # machine overview: health strip, services, cluster, ingress, backups & timers, activity
├── systems_.$systemId.metrics.tsx               # metric charts with range switcher
├── systems_.$systemId.services.tsx              # systemd system and user units, timers: filter, state chips, pins, actions
├── systems_.$systemId.services_.$unitId.tsx     # unit detail: status, actions, properties, journal, unit file
├── systems_.$systemId.cluster.tsx               # k8s namespaces, workloads, pods, warning events
├── systems_.$systemId.plugins.$pluginId.tsx     # generic plugin screens (json-render catalog)
├── alerts.tsx / terminal.tsx / settings.tsx
├── operator.tsx                                 # operator session list
├── operator_.$sessionId.tsx                     # operator session detail (flat route)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| App shell, bottom nav, terminal panel | `__root.tsx` | Also seeds initial systems/alerts into atoms |
| Machine overview | `systems.$systemId.tsx` | Failed units first, then units pinned in this browser |
| systemd pages | `systems_.$systemId.services*.tsx` | Actions go through `useUnitAction` (confirmed) |
| Cluster page | `systems_.$systemId.cluster.tsx` | Empty state explains a degraded or missing k8s plugin |
| Plugin detail page | `systems_.$systemId.plugins.$pluginId.tsx` | For plugins without a dedicated page (e.g. Docker) |
| Operator pages | `operator.tsx`, `operator_.$sessionId.tsx` | Session list + detail; flat route pattern |

## CONVENTIONS
- Keep route-specific loader logic close to the route and delegate HTTP bootstrap calls to `src/server/*`.
- Reuse shared shell components from `__root.tsx`; child routes render content inside `Page` / `PageHeader` / `Section` (`src/components/section.tsx`), not their own navigation.
- Route params and wire data should stay aligned with `@scout/shared` schemas and RPC names.
- Keep page-specific UI helpers near the route until they become reusable across multiple pages.
- Never hard-code a machine; take it from `$systemId` or `useCurrentSystem()`.

## ANTI-PATTERNS
- Do not move root-shell concerns into leaf routes.
- Do not bypass `HubClient` for live updates when a route already depends on shared RPC state.
- Do not split one route across many tiny files unless the extraction follows a real UI boundary.
