# Scout Operator -- User Guide

The operator is an AI-powered assistant for system administration built into the Scout dashboard. It can inspect your infrastructure, run diagnostics, execute management actions, and tail logs -- all through a conversational interface with approval controls.

## What is the Operator

The operator is a persistent chat interface backed by an LLM (via pi-durable, a durable agent harness) that has access to your monitored systems through Scout's existing hub-to-agent RPC infrastructure. Each conversation is a **session** with an explicit **node scope** that determines which systems the operator can interact with.

Sessions are durable: the conversation, running tool calls, and pending approvals survive a hub restart, and the operator continues where it stopped.

The operator is behind the same Cloudflare Access login as the rest of Scout. Every operator action is recorded in the hub's audit log with who did it, and approval cards show who approved or rejected each call.

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

| Tool              | Description                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `observe_systems` | List systems in the session scope with current status and plugin capability summary                   |
| `observe_alerts`  | List active or acknowledged alerts within the session scope                                           |
| `observe_metrics` | Inspect the latest host metrics (CPU, memory, disk, network, GPU, uptime) for scoped nodes            |
| `observe_plugins` | Discover plugin capabilities including available actions, streams, entity counts, and recent activity |

### Action Tools

| Tool                | Description                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bash_run`          | Execute a shell command on a scoped node over the Scout PTY transport. The `isMutation` flag controls whether the command is treated as read-only or mutating for approval purposes. |
| `plugin_run_action` | Execute a plugin action (e.g., restart a Docker container, scale a Kubernetes deployment) through the hub-to-agent plugin management RPC                                             |
| `plugin_logs`       | Read a bounded slice of plugin log output (e.g., systemd journal, container logs, pod logs) from a scoped node                                                                       |
| `ask_user`          | Ask the user a clarifying question with structured options. The operator waits for your answer (pick options and/or type free text); the answer text goes back to the model.         |

### Plugin-Contributed Tools

Installed plugins can contribute additional operator tools. These appear alongside the built-in tools and follow the same approval rules. Use `observe_plugins` to discover what plugin capabilities are available.

## Approval Modes

Every session has an approval mode that controls when the operator pauses for user confirmation before executing a tool.

| Mode                    | Behavior                                                                                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `confirm_each_mutation` | **(Default)** All mutating tools require approval. Read-only observe tools and `bash_run` with `isMutation: false` execute freely.                                                                                                 |
| `auto_approve_reads`    | Observe tools, `ask_user`, `plugin_logs`, and non-mutating `bash_run` execute without approval. Only mutating `bash_run`, `plugin_run_action` (when the action requires confirmation), and mutating plugin tools require approval. |
| `auto_approve_all`      | No approval is ever required. The operator executes all tools immediately. The prompt input border turns red as a visual warning when this mode is active.                                                                         |

When an approval is requested, the call waits: nothing executes until you decide. The session status changes to `waiting_for_user` and the approval card appears inline with the tool call. Approve to run it once; reject to tell the operator not to. A pending approval survives a hub restart. If the hub restarts while an approved call is executing, the call is reported as interrupted and is never run a second time. The keyboard shortcut **Cmd+.** approves the first pending mutation approval.

The `ask_user` tool always waits for an answer regardless of the approval mode. This is how the operator asks follow-up questions.

Press **Stop** while the operator is working to abort the run; pending approvals become canceled.

## Plan Mode

Each session can be toggled between **Build** and **Plan** mode:

| Mode                | Behavior                                                                                                                                                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Build** (default) | The operator executes tools directly as needed                                                                                                                                                                                                                                                            |
| **Plan**            | The operator is instructed to observe and propose a step-by-step plan before taking any mutating action. Mutating tools (`bash_run` with `isMutation: true`, `plugin_run_action`, and mutating plugin tools) are blocked before they run. The operator can still freely use observe tools to investigate. |

Toggle plan mode with the **Plan/Build** button in the prompt input footer or with **Cmd+Shift+P**.

## Keyboard Shortcuts

All shortcuts use `react-hotkeys-hook` and work from anywhere in the session panel.

| Shortcut      | Action                                                             |
| ------------- | ------------------------------------------------------------------ |
| `/`           | Focus the prompt editor                                            |
| `Enter`       | Send the current prompt                                            |
| `Shift+Enter` | Insert a newline in the prompt editor                              |
| `Cmd+Shift+P` | Toggle Plan/Build mode                                             |
| `Cmd+Shift+A` | Cycle approval mode (confirm -> auto-reads -> auto-all -> confirm) |
| `Cmd+.`       | Approve the first pending approval                                 |
| `Cmd+K`       | Open the command palette                                           |
| `Cmd+B`       | Toggle the sidebar                                                 |
| `Ctrl+`` `    | Toggle the terminal panel                                          |

## Sessions

### Session List

The operator workbench (`/operator`) shows all non-archived sessions ordered by last update time. Each card shows the session title, status, model, and node scope.

### Session Detail

Click a session to open it. The detail view shows:

- **Timeline**: user messages, assistant responses (streamed as they generate), and tool calls with their output and approvals
- **Metadata sidebar** (workbench only): Session properties, node scope, attached skills, model info, and approval/plan mode controls

### Session Management

| Action      | How                                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rename**  | Use the `operator.sessions.setTitle` RPC. The client titles a new session from its first prompt.                                                   |
| **Archive** | From the session menu or via RPC. Archived sessions are hidden from the list but retained in the database.                                         |
| **Delete**  | From the session menu or via RPC. Stops the session and removes it from the list. Its transcript remains in the operator database file.            |
| **Fork**    | From a user or assistant message. Creates a new session that sees the conversation up to and including that message, then continues independently. |

## Skills

Skills are system prompt extensions that give the operator specialized knowledge or procedures for specific tasks.

### Built-in Skills

| Skill             | Description                                  |
| ----------------- | -------------------------------------------- |
| `incident-triage` | Structured incident investigation workflow   |
| `plugin-ops`      | Plugin management and diagnostics procedures |

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

Open the "Manage Skills" dialog from the session menu to attach or detach skills. Attached skills are part of the system prompt from the next model request.

## Rich Prompt Input

The prompt editor is a tiptap-based rich text input with several extensions:

| Feature                | Trigger        | Description                                                                                       |
| ---------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| @mention nodes         | `@`            | Opens a filtered list of systems. Selected nodes are inserted as styled pills.                    |
| /slash commands        | `/`            | Opens a command menu with built-in commands and attached skills.                                  |
| Image paste            | Paste/drag     | Attach images directly into the prompt. Thumbnails appear above the editor.                       |
| History                | Up/Down arrows | Navigate through previous prompts (up to 50, persisted in localStorage).                          |
| Node scope selector    | Footer button  | Toggle which nodes are in scope for the session.                                                  |
| Model selector         | Footer button  | Switch the LLM model for the session. Shows available providers and models with reasoning badges. |
| Approval mode selector | Footer button  | Switch between confirm/auto-reads/auto-all.                                                       |
| Plan mode toggle       | Footer button  | Toggle between Build and Plan mode.                                                               |

### Suggestion Chips

When a session is newly created and has no messages, four suggestion chips are displayed:

- "Check the health of all nodes"
- "Are there any active alerts?"
- "What plugins are available?"
- "Show me resource usage across nodes"

Clicking a chip fills the prompt editor with that text.

## Streaming and Real-Time Updates

The operator streams results to the browser in real time. As the LLM generates its response, partial content appears as it is committed (at most every 100 ms). Tool executions show progress as they run -- for example, `bash_run` streams terminal output and `plugin_logs` streams log batches as they arrive.

## Terminal Projections

When the operator runs `bash_run`, it opens a real PTY session on the target node through Scout's terminal infrastructure. The terminal output is:

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

The operator supports the LLM providers built into pi-ai. Available models depend on which provider API keys are configured in the hub environment (for example `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). `SCOUT_OPERATOR_MODEL_PROVIDER` and `SCOUT_OPERATOR_MODEL_ID` choose the default model for new sessions. For local smoke tests without credentials, `SCOUT_OPERATOR_MODEL_PROVIDER=faux` selects a scripted model that echoes prompts and runs `/tool <name> <json-args>`.

The model selector in the prompt input footer shows all available models with:

- Provider and model ID (e.g., `anthropic/claude-sonnet-4-20250514`)
- A "reasoning" badge for models that support extended thinking

A session keeps the model it was created with.
