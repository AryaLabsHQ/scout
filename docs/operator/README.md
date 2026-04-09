# Scout Operator -- User Guide

The operator is an AI-powered assistant for system administration built into the Scout dashboard. It can inspect your infrastructure, run diagnostics, execute management actions, and tail logs -- all through a conversational interface with approval controls.

## What is the Operator

The operator is a persistent chat interface backed by an LLM (via pi-agent-core) that has access to your monitored systems through Scout's existing hub-to-agent RPC infrastructure. Each conversation is a **session** with an explicit **node scope** that determines which systems the operator can interact with.

The operator runs entirely on the hub. When it needs to inspect or act on a node, it issues the same typed RPC calls that the dashboard uses. There is no separate agent sidecar or SSH connection.

## Creating Sessions

There are two ways to create a new operator session:

1. **Sidebar drawer**: Click the [+] button in the operator sidebar (accessible from any page). This opens a new session in the slide-over drawer.
2. **Workbench page**: Navigate to `/operator` and click "New Session". This opens a full-page session view with a collapsible metadata sidebar.

When creating a session, all online nodes are selected by default. You can adjust the node scope using the node selector in the prompt input footer.

## Sending Prompts

Type your prompt in the tiptap editor at the bottom of the session panel and press **Enter** to send. The operator will process your request, potentially calling multiple tools, and stream its response back in real time.

The prompt input supports:
- **@mentions**: Type `@` followed by a node hostname to reference a specific system in your prompt. Mentions are rendered as pills and resolved to system IDs.
- **/commands**: Type `/` to open the slash command menu. Built-in commands include `/clear`. Attached skills also appear as slash commands.
- **Image paste**: Paste or drag images into the editor to attach them to your prompt (e.g., screenshots of dashboards or error messages).
- **History navigation**: Press **Up/Down** arrow keys (when the editor is empty) to cycle through your last 50 prompts. History is persisted in localStorage.

## Tools

The operator has access to 8 built-in tools, plus any tools contributed by installed plugins.

### Observe Tools (read-only)

| Tool | Description |
|------|-------------|
| `observe.systems` | List systems in the session scope with current status and plugin capability summary |
| `observe.alerts` | List active or acknowledged alerts within the session scope |
| `observe.metrics` | Inspect the latest host metrics (CPU, memory, disk, network, GPU, uptime) for scoped nodes |
| `observe.plugins` | Discover plugin capabilities including available actions, streams, entity counts, and recent activity |

### Action Tools

| Tool | Description |
|------|-------------|
| `bash.run` | Execute a shell command on a scoped node over the Scout PTY transport. The `isMutation` flag controls whether the command is treated as read-only or mutating for approval purposes. |
| `plugin.runAction` | Execute a plugin action (e.g., restart a Docker container, scale a Kubernetes deployment) through the hub-to-agent plugin management RPC |
| `plugin.logs` | Read a bounded slice of plugin log output (e.g., systemd journal, container logs, pod logs) from a scoped node |
| `ask_user` | Ask the operator user a clarifying question with structured options. Always triggers a clarification approval to pause execution until the user responds. |

### Plugin-Contributed Tools

Installed plugins can contribute additional operator tools. These appear alongside the built-in tools and follow the same approval rules. Use `observe.plugins` to discover what plugin capabilities are available.

## Approval Modes

Every session has an approval mode that controls when the operator pauses for user confirmation before executing a tool.

| Mode | Behavior |
|------|----------|
| `confirm_each_mutation` | **(Default)** All mutating tools require approval. Read-only observe tools and `bash.run` with `isMutation: false` execute freely. |
| `auto_approve_reads` | Observe tools, `ask_user`, `plugin.logs`, and non-mutating `bash.run` execute without approval. Only mutating `bash.run`, `plugin.runAction` (when the action requires confirmation), and mutating plugin tools require approval. |
| `auto_approve_all` | No approval is ever required. The operator executes all tools immediately. The prompt input border turns red as a visual warning when this mode is active. |

When an approval is requested, the session status changes to `waiting_for_user` and the approval card appears inline in the chat. You can approve or reject it. The keyboard shortcut **Cmd+.** approves the first pending approval.

The `ask_user` tool always triggers a clarification approval regardless of the approval mode. This is how the operator asks follow-up questions.

## Plan Mode

Each session can be toggled between **Build** and **Plan** mode:

| Mode | Behavior |
|------|----------|
| **Build** (default) | The operator executes tools directly as needed |
| **Plan** | The operator is instructed to observe and propose a step-by-step plan before taking any mutating action. Mutating tools (`bash.run` with `isMutation: true`, `plugin.runAction`, and mutating plugin tools) are blocked at the `beforeToolCall` hook level. The operator can still freely use observe tools to investigate. |

Toggle plan mode with the **Plan/Build** button in the prompt input footer or with **Cmd+Shift+P**.

## Keyboard Shortcuts

All shortcuts use `react-hotkeys-hook` and work from anywhere in the session panel.

| Shortcut | Action |
|----------|--------|
| `/` | Focus the prompt editor |
| `Enter` | Send the current prompt |
| `Shift+Enter` | Insert a newline in the prompt editor |
| `Cmd+Shift+P` | Toggle Plan/Build mode |
| `Cmd+Shift+A` | Cycle approval mode (confirm -> auto-reads -> auto-all -> confirm) |
| `Cmd+.` | Approve the first pending approval |
| `Cmd+K` | Open the command palette |
| `Cmd+B` | Toggle the sidebar |
| `Ctrl+`` ` | Toggle the terminal panel |

## Sessions

### Session List

The operator workbench (`/operator`) shows all non-archived sessions ordered by last update time. Each card shows the session title, status, model, node scope, and summary.

### Session Detail

Click a session to open it. The detail view shows:
- **Timeline**: A chronological stream of events -- user messages, assistant responses, tool executions, approvals, and streaming content
- **Metadata sidebar** (workbench only): Session properties, node scope, attached skills, model info, and approval/plan mode controls

### Session Management

| Action | How |
|--------|-----|
| **Rename** | Use the `operator.sessions.setTitle` RPC (or the client sets a fallback title from the first prompt; the server generates a better title asynchronously via a dedicated subagent) |
| **Archive** | From the session menu or via RPC. Archived sessions are hidden from the list but retained in the database. |
| **Delete** | From the session menu or via RPC. Permanently removes the session and all associated events, entries, tool calls, approvals, and projections (cascade delete). |
| **Branch** | Right-click or use the menu on any event card to branch. Creates a new conversation fork at that point in the entry tree, reusing the same session. The branch resets the current leaf entry pointer. |
| **Fork** | Similar to branch, but creates a new independent session that copies the entry history up to the fork point. The forked session appears in the session list as a new entry. |

## Skills

Skills are system prompt extensions that give the operator specialized knowledge or procedures for specific tasks.

### Built-in Skills

| Skill | Description |
|-------|-------------|
| `incident-triage` | Structured incident investigation workflow |
| `plugin-ops` | Plugin management and diagnostics procedures |

### Custom Skills

Create a `SKILL.md` file with YAML frontmatter in any directory configured via `SCOUT_OPERATOR_SKILLS_DIRS`:

```markdown
---
name: my-custom-skill
description: A brief description of what this skill provides
---

Your skill content here. This becomes part of the operator's
system prompt when the skill is attached to a session.
```

Skills are discovered recursively from:
1. Built-in skills directory (`apps/hub/skills/`)
2. Directories listed in `SCOUT_OPERATOR_SKILLS_DIRS` (colon-separated)
3. Plugin-contributed skills (from plugin operator surfaces)

### Attaching Skills

Open the "Manage Skills" dialog from the session menu to attach or detach skills. Attached skills are injected into the system prompt before each operator turn.

## Rich Prompt Input

The prompt editor is a tiptap-based rich text input with several extensions:

| Feature | Trigger | Description |
|---------|---------|-------------|
| @mention nodes | `@` | Opens a filtered list of systems. Selected nodes are inserted as styled pills. |
| /slash commands | `/` | Opens a command menu with built-in commands and attached skills. |
| Image paste | Paste/drag | Attach images directly into the prompt. Thumbnails appear above the editor. |
| History | Up/Down arrows | Navigate through previous prompts (up to 50, persisted in localStorage). |
| Node scope selector | Footer button | Toggle which nodes are in scope for the session. |
| Model selector | Footer button | Switch the LLM model for the session. Shows available providers and models with reasoning badges. |
| Approval mode selector | Footer button | Switch between confirm/auto-reads/auto-all. |
| Plan mode toggle | Footer button | Toggle between Build and Plan mode. |

### Suggestion Chips

When a session is newly created and has no events, four suggestion chips are displayed:
- "Check the health of all nodes"
- "Are there any active alerts?"
- "What plugins are available?"
- "Show me resource usage across nodes"

Clicking a chip fills the prompt editor with that text.

## Streaming and Real-Time Updates

The operator streams results to the browser in real time. As the LLM generates its response, partial content appears with a typing animation. Tool executions show progress as they run -- for example, `bash.run` streams terminal output line by line, and `plugin.logs` streams log batches as they arrive.

The event stream also carries session metadata updates:
- **Title updates**: After the first prompt, a dedicated subagent generates a concise title. This replaces the placeholder title without requiring a page refresh.
- **Summary updates**: After each turn, a dedicated subagent generates a 1-2 sentence summary that appears on the session card in the list view.

Both title and summary generation happen asynchronously and do not block the main conversation.

## Terminal Projections

When the operator runs `bash.run`, it opens a real PTY session on the target node through Scout's terminal infrastructure. The terminal output is:

1. Streamed inline in the chat as part of the tool execution card
2. Projected into a terminal panel tab (accessible via the terminal panel at the bottom of the screen)

Terminal projections let you see the full terminal output alongside the operator's interpretation of the results.

## Node Scope

Every session has an explicit node scope -- the set of systems the operator is allowed to interact with. This scope is:

- Set at session creation time (defaults to all online nodes)
- Adjustable via the node scope selector in the prompt input footer
- Enforced at the tool level: every tool call validates that target nodes are within scope
- Passed to plugin hooks so plugins can scope their behavior

The node scope serves as a safety boundary. Even with `auto_approve_all` enabled, the operator cannot reach nodes outside the session scope.

## Models

The operator supports multiple LLM providers and models through the `OperatorModelRegistry`. Available providers and models depend on which API keys are configured in the environment.

The model selector in the prompt input footer shows all available models with:
- Provider and model ID (e.g., `anthropic/claude-sonnet-4-20250514`)
- A "reasoning" badge for models that support extended thinking

You can switch models mid-session. The new model takes effect on the next prompt turn.
