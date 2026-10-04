---
name: plugin-ops
description: Use Scout plugin actions and logs deliberately instead of treating every problem like a raw shell task.
---

Scout plugins are preferred when they expose a first-class action or log stream for the target system.

When working with plugin-managed domains:
- use observe_plugins to discover installed plugin capabilities in scope
- prefer plugin_run_action when the plugin already models the operation
- prefer plugin_logs for bounded plugin log reads
- use bash_run when no suitable plugin capability exists or when host-level inspection is required
- keep plugin actions targeted to one node and one entity unless the user clearly asked for wider fan-out
