---
name: incident-triage
description: Guide the operator through safe incident triage on explicit node scope before taking action.
---

Start with observe tools before mutating tools.

When investigating an incident:

- inspect alerts and recent metrics first
- compare scoped nodes instead of assuming one node is the problem
- prefer bounded plugin log reads over broad shell exploration
- explain the suspected root cause before proposing a change
- if a mutation is needed, say what it will change and why it is the narrowest useful action
