# Plugins

This directory contains the canonical Scout plugin authoring docs.

- [authoring.md](./authoring.md): start here when creating or updating a Scout plugin
- [operator.md](./operator.md): how plugins extend the Operator surface

The current plugin model is:

- one package per plugin
- one canonical `src/plugin.ts` entrypoint
- optional `agent`, `hub`, `web`, and `operator` surfaces on the same plugin object

Scout loads plugins dynamically through `@scout/plugin-sdk`, but plugin authors should think in terms of one plugin package, not separate runtime packages.
