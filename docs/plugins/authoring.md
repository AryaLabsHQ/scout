# Scout Plugin Authoring Guide

This is the canonical guide for authoring Scout plugins.

## Mental Model

A Scout plugin is one package that may expose four optional surfaces:

- `agent`: node-side detection, collection, actions, and streams
- `hub`: hub-side metadata or server behavior
- `web`: plugin screens and UI surface
- `operator`: tools, resources, skills, and hooks for the Operator

The canonical entrypoint is `src/plugin.ts`. Everything else is decomposition.

Use a plugin when you are modeling an operational domain with stable entities, metrics, actions, streams, UI, or operator behavior. Do not use a plugin for generic host telemetry that already belongs in the core collectors.

## Canonical Structure

Recommended package layout:

```text
src/
  plugin.ts
  manifest.ts
  contracts.ts
  agent.ts
  hub.ts
  web.ts
  operator.ts
```

What each file is for:

- `plugin.ts`: canonical entrypoint; assembles the plugin object
- `manifest.ts`: stable plugin identity, permissions, and contract metadata
- `contracts.ts`: ids, schemas, UI screen definitions, and other shared constants
- `agent.ts`: exported `agent` surface
- `hub.ts`: exported `hub` surface
- `web.ts`: exported `web` surface
- `operator.ts`: exported `operator` surface

Not every plugin needs every file, but `plugin.ts`, `manifest.ts`, and `contracts.ts` should almost always exist.

## Smallest Complete Plugin

```ts
// src/manifest.ts
import type { PluginManifest } from "@scout/plugin-sdk"

export const manifest = {
  apiVersion: "v0alpha1",
  id: "@scout/plugin-example",
  displayName: "Example",
  version: "0.0.1",
  description: "Example Scout plugin",
  permissions: ["node:read-files"],
  capabilities: [
    {
      id: "example",
      displayName: "Example",
      description: "Example capability",
    },
  ],
  entityKinds: [],
  metrics: [],
  actions: [],
  streams: [],
  alerts: [],
} satisfies PluginManifest
```

```ts
// src/agent.ts
import { Effect } from "effect"
import { defineAgent } from "@scout/plugin-sdk"

export const agent = defineAgent({
  detect: () =>
    Effect.succeed({
      pluginId: "@scout/plugin-example",
      version: "0.0.1",
      status: "available" as const,
      features: [],
    }),
})
```

```ts
// src/web.ts
import { defineWeb } from "@scout/plugin-sdk"

export const web = defineWeb({
  screens: [],
})
```

```ts
// src/operator.ts
import { defineOperator, defineOperatorSkill } from "@scout/plugin-sdk/operator"

export const operator = defineOperator({
  skills: [
    defineOperatorSkill({
      id: "example-skill",
      name: "Example Skill",
      description: "Operator guidance for the example plugin.",
      content: "Prefer typed plugin capabilities before falling back to bash_run.",
    }),
  ],
})
```

```ts
// src/plugin.ts
import { definePlugin } from "@scout/plugin-sdk"
import { agent } from "./agent.js"
import { manifest } from "./manifest.js"
import { operator } from "./operator.js"
import { web } from "./web.js"

export const plugin = definePlugin({
  manifest,
  agent,
  web,
  operator,
})

export default plugin
```

## The Public API

The main SDK helpers are:

- `definePlugin(...)`
- `defineAgent(...)`
- `defineHub(...)`
- `defineWeb(...)`
- `defineOperator(...)`

Operator-specific helpers are:

- `defineOperatorTool(...)`
- `defineOperatorResource(...)`
- `defineOperatorSkill(...)`

These helpers exist to keep multi-file plugin decomposition ergonomic while preserving type inference.

## Manifest And Contracts

`manifest.ts` and `contracts.ts` are the stable public face of a plugin.

Put these in `contracts.ts`:

- plugin ids
- capability ids
- entity kind ids
- metric ids
- action ids
- stream ids
- input and output schemas
- plugin UI screen definitions

Put these in `manifest.ts`:

- human-facing plugin metadata
- permissions
- capabilities
- entity kinds
- metrics
- actions
- streams
- alerts

Rules:

- ids must be stable and explicit
- permissions should be as narrow as possible
- actions and streams should be discoverable from the manifest
- do not duplicate ids across files without a shared constant

## Agent Surface

The `agent` surface is where node-side behavior lives.

It can expose:

- `detect`
- `collect`
- `actions`
- `streams`

Use `detect` to decide whether the capability is available on a node.

Use `collect` for periodic inventory and metrics collection.

Use `actions` for bounded typed operations.

Use `streams` for typed, bounded streaming interfaces like logs or events.

Design rules:

- prefer typed actions over shell commands
- prefer bounded streams over unbounded tails
- fail loudly on invalid input
- make target kinds explicit

## Hub Surface

The `hub` surface should stay small.

Use it for plugin metadata the hub needs directly, such as:

- alert definitions
- future hub-side enrichers or read helpers, if the SDK grows there

Do not put general operator behavior here. That belongs in `operator`.

## Web Surface

The `web` surface defines plugin UI screens.

Use it when a plugin needs a dedicated browser surface for:

- overview pages
- entity lists
- entity detail screens

Keep screen ids and screen kinds stable. Treat `contracts.ts` as the source of truth for screen definitions and ids.

## Operator Surface

The `operator` surface is how plugins extend the Operator.

It can currently contribute:

- `tools`
- `resources`
- `skills`
- `hooks`

Use `tools` for typed domain-specific operator actions.

Use `resources` for read-only context the Operator can load selectively.

Use `skills` for reusable behavioral guidance.

Use `hooks` to enrich prompt and tool lifecycle behavior.

Do not treat `operator` as a second packaging model. It is just one surface of the same plugin.

See [operator.md](./operator.md) for the deeper guidance.

## Design Rules

- Prefer typed plugin actions and operator tools over `bash_run`.
- Prefer plugin logs/streams over raw shell access when the domain already has a typed interface.
- Keep permissions narrow and explicit.
- Make actions and streams bounded and well-scoped.
- Keep operator skills specific to the plugin domain.
- Keep operator resources short, factual, and actually useful.
- Use hooks to enrich behavior, not to bypass Scout core policy.
- Do not duplicate capabilities that already exist in core collectors unless the plugin is modeling a richer operational domain.

## Choosing The Right Abstraction

Use a core collector when:

- the capability is universal host telemetry
- there is no strong domain model with entities/actions/streams
- the data should exist even with zero plugins installed

Use a plugin when:

- you are modeling a real operational domain
- the domain has stable entities, actions, streams, or UI
- the Operator benefits from domain-specific tools/resources/skills

Use an operator resource when:

- the data is read-only context
- it should be loaded selectively
- it is not an executable capability

Use an operator skill when:

- you want reusable behavioral guidance
- the content is instruction-like rather than data-like

Use an operator tool when:

- the Operator needs a typed capability, not just text guidance

## Testing Plugins

At minimum, test:

- manifest validity
- `detect`
- `collect`
- action execution behavior
- stream behavior
- loader compatibility with `src/plugin.ts`

If a plugin exposes an `operator` surface, also test:

- operator skill/resource shape
- operator tool behavior
- hook behavior where relevant

Useful references:

- [packages/plugin-sdk/test/fixtures/valid-plugin/src/plugin.ts](/Users/aryasaatvik/Developer/scout/packages/plugin-sdk/test/fixtures/valid-plugin/src/plugin.ts)
- [packages/plugin-docker/src/plugin.ts](/Users/aryasaatvik/Developer/scout/packages/plugin-docker/src/plugin.ts)
- [packages/plugin-k8s/src/plugin.ts](/Users/aryasaatvik/Developer/scout/packages/plugin-k8s/src/plugin.ts)
- [packages/plugin-systemd/src/plugin.ts](/Users/aryasaatvik/Developer/scout/packages/plugin-systemd/src/plugin.ts)

## Reference

Current plugin loading behavior:

- Scout discovers plugin packages dynamically
- the canonical entrypoint is `plugin.ts`
- valid locations are `plugin.ts` or `src/plugin.ts`
- plugins are loaded as one object, not as separate manifest/runtime entrypoints

Relevant source files:

- [packages/plugin-sdk/src/runtime.ts](/Users/aryasaatvik/Developer/scout/packages/plugin-sdk/src/runtime.ts)
- [packages/plugin-sdk/src/operator.ts](/Users/aryasaatvik/Developer/scout/packages/plugin-sdk/src/operator.ts)
- [packages/plugin-sdk/src/loader.ts](/Users/aryasaatvik/Developer/scout/packages/plugin-sdk/src/loader.ts)
- [packages/plugin-sdk/src/schemas.ts](/Users/aryasaatvik/Developer/scout/packages/plugin-sdk/src/schemas.ts)
