---
name: plugin-ops
description: Use Scout plugin actions and logs deliberately instead of treating every problem like a raw shell task.
---

Scout plugins are preferred when they expose a first-class action or log stream for the target system.

When working with plugin-managed domains:
- use observe.plugins to discover installed plugin capabilities in scope
- prefer plugin.runAction when the plugin already models the operation
- prefer plugin.logs for bounded plugin log reads
- use bash.run when no suitable plugin capability exists or when host-level inspection is required
- keep plugin actions targeted to one node and one entity unless the user clearly asked for wider fan-out
