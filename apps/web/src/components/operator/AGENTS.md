# Operator Web Components

## OVERVIEW
The operator chat UI is decomposed into 7 component files + 10 tiptap extension files. State flows from route params through `OperatorShell` to `OperatorSessionPanel`.

## STRUCTURE
| File | Purpose |
|------|---------|
| `operator-shell.tsx` | Session list view, routing, quick create |
| `operator-session-panel.tsx` | Watch stream, state, layout, keyboard shortcuts, terminal mirroring |
| `operator-prompt-input.tsx` | Tiptap editor, footer controls (model, scope, approval, plan, stop, queued count) |
| `operator-timeline-item.tsx` | User/assistant/tool timeline items, inline approvals and clarification answers |
| `operator-session-meta.tsx` | Right sidebar metadata cards |
| `operator-dialogs.tsx` | Create session + manage skills dialogs |
| `operator-utils.ts` | Shared constants and small helpers |
| `tiptap/` | Keyboard, @mention, /slash, attachment extensions |

## STATE FLOW
- `/operator` route -> `OperatorShell` (no `initialSessionId`) -> session list view
- `/operator/$sessionId` route -> `OperatorShell` (with `initialSessionId`) -> `OperatorSessionPanel`
- The hub owns session state (pi-durable). The panel renders an `OperatorSessionDetail` snapshot; it never reduces events.
- Live detail comes from `operator.sessions.watch`, pulled with `HubClient.runtime.pull(..., { disableAccumulation: true })`; each emission is a full snapshot and the latest wins.
- Until the first snapshot arrives, the panel shows the `operator.sessions.get` result or the provider's optimistic detail (set after create/fork).
- A streaming answer is an `assistant` timeline item with `streaming: true`.
- Approvals render inline under their tool item (`tool.approvalId`); pending approvals without a tool item render at the end of the timeline. Clarifications send the chosen option labels and/or free text as `answer`.
- Prompts carry a fresh `requestId`; prompting while the session is busy queues a follow-up (`queuedInputs`). Stop calls `operator.sessions.abort`.
- Fork targets a user/assistant item's `entryId` and navigates to the new session.
- Tool items with `terminal` mirror into the terminal dock as projection `${sessionId}:${toolCallId}`.

## CONVENTIONS
- Keyboard shortcuts use `react-hotkeys-hook` (`useHotkeys`)
- Command palette commands dispatch custom events consumed by the session panel
- Approval mode and plan mode changes patch the live snapshot optimistically; the next snapshot supersedes it
- Branch on `approval.kind` and `item.terminal`, not on tool names
- Icons from `@hugeicons/core-free-icons`, never emojis
