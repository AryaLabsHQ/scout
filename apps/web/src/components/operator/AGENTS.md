# Operator Web Components

## OVERVIEW
The operator chat UI is decomposed into 7 component files + 10 tiptap extension files. State flows from route params through `OperatorShell` to `OperatorSessionPanel`.

## STRUCTURE
| File | Lines | Purpose |
|------|-------|---------|
| `operator-shell.tsx` | ~200 | Session list view, routing, quick create |
| `operator-session-panel.tsx` | ~785 | Streaming, state, layout, keyboard shortcuts |
| `operator-prompt-input.tsx` | ~523 | Tiptap editor, footer controls (model, scope, approval, plan) |
| `operator-event-card.tsx` | ~546 | Message bubbles, collapsible tools, approvals, clarifications |
| `operator-session-meta.tsx` | ~97 | Right sidebar metadata cards |
| `operator-dialogs.tsx` | ~238 | Create session + manage skills dialogs |
| `operator-utils.ts` | ~165 | applyOperatorEvent reducer, helper maps, formatters |
| `tiptap/` | 10 files | Keyboard, @mention, /slash, attachment extensions |

## STATE FLOW
- `/operator` route -> `OperatorShell` (no `initialSessionId`) -> session list view
- `/operator/$sessionId` route -> `OperatorShell` (with `initialSessionId`) -> `OperatorSessionPanel`
- Panel fetches session detail via `HubClient.query("operator.sessions.get")`
- Live updates via `HubClient.runtime.pull(Stream)` on `operator.events.subscribe`
- Transient events (`message.streaming`, `session.title_updated`, `session.summary_updated`) update `liveDetail` state directly
- Persistent events go through `applyOperatorEvent` reducer

## CONVENTIONS
- Keyboard shortcuts use `react-hotkeys-hook` (`useHotkeys`)
- Command palette commands dispatch custom events consumed by the session panel
- Approval mode and plan mode changes are optimistic (update liveDetail immediately)
- Icons from `@hugeicons/core-free-icons`, never emojis
