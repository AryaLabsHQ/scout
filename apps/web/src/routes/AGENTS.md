# WEB ROUTES

## OVERVIEW
Route files here define page boundaries, page-level loaders, and most dashboard composition. `__root.tsx` owns the shell; other files map 1:1 to concrete pages and detail views.

## STRUCTURE
```text
apps/web/src/routes/
├── __root.tsx                              # app shell, sidebar, terminal panel, seeded loaders
├── overview.tsx / alerts.tsx / terminal.tsx / settings.tsx
├── systems.$systemId.tsx                   # system detail and metrics
├── systems_.$systemId.plugins.$pluginId.tsx # plugin detail view
├── operator.tsx                          # operator session list
├── operator_.$sessionId.tsx              # operator session detail (flat route)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| App shell, sidebar, bottom nav, terminal panel | `__root.tsx` | Also seeds initial systems/alerts into atoms |
| Overview / alerts / terminal / settings pages | `overview.tsx`, `alerts.tsx`, `terminal.tsx`, `settings.tsx` | Standard page entry points |
| System detail pages | `systems.$systemId.tsx` | Metrics and plugin overview live here |
| Plugin detail page | `systems_.$systemId.plugins.$pluginId.tsx` | Biggest route file; inspect before refactoring |
| Operator pages | `operator.tsx`, `operator_.$sessionId.tsx` | Session list + detail; flat route pattern |

## CONVENTIONS
- Keep route-specific loader logic close to the route and delegate HTTP bootstrap calls to `src/server/*`.
- Reuse shared shell components from `__root.tsx`; child routes should render content, not rebuild navigation or terminal chrome.
- Route params and wire data should stay aligned with `@scout/shared` schemas and RPC names.
- Keep page-specific UI helpers near the route until they become reusable across multiple pages.

## ANTI-PATTERNS
- Do not move root-shell concerns into leaf routes.
- Do not bypass `HubClient` for live updates when a route already depends on shared RPC state.
- Do not split one route across many tiny files unless the extraction follows a real UI boundary.
