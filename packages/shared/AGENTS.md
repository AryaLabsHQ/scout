# SHARED CONTRACTS

## OVERVIEW
`packages/shared` is the cross-runtime contract package. It exports Effect Schema models, RPC groups, and a small set of legacy TS-only domain interfaces that have not been migrated to schema-derived types yet.

## STRUCTURE
```text
packages/shared/
├── src/schemas/   # canonical Effect Schema contracts
├── src/rpc/       # browser↔hub and hub↔agent RPC groups plus duplex adapter
├── src/types/     # TS-only interfaces that do not yet have schema coverage
└── src/index.ts   # public package barrel
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add or change shared models | `src/schemas` | Export new schemas from `src/schemas/index.ts` |
| Operator session/tool schemas | `src/schemas/operator.ts` | Session summary/detail projections, timeline items, approval payloads |
| Add or change RPC endpoints | `src/rpc` | Keep directionality split by caller/callee; operator.* RPCs live in `client-hub.ts` |
| Find legacy TS-only shapes | `src/types` | `src/index.ts` documents which areas are still not schema-backed |

## CONVENTIONS
- Prefer schema-first additions here so apps can import one canonical contract.
- Keep this package runtime-agnostic; no app-layer imports.
- Update consumers after changing shared shapes instead of adding compatibility wrappers locally.

## ANTI-PATTERNS
- Do not define browser-only or hub-only copies of shared payloads in app packages.
- Do not add app/service dependencies to this package.
- Do not leave new public contracts out of `src/index.ts`.
