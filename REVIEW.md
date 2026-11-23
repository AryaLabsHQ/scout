# Review rules

Scout is a self-hosted Bun + Effect control plane (apps/agent, apps/hub, apps/web; plugin packages
under packages/; e2e lab; deploy kit). Follow root AGENTS.md and the nearest scoped AGENTS.md. Prefer
logic findings over style. Skip generated output (build directories, generated `.gen.ts` files,
lockfiles).

This file is for whoever reviews a change, person or tool. A rule applies to a change that touches a
file its `Applies to` patterns match. Cite the rule's id in a finding.

## scout-effect-services

- Severity: high
- Applies to: `apps/**`, `packages/**`

Services use Effect Context.Service with a static layer, composed with Layer.provide,
Layer.provideMerge, or Layer.mergeAll from apps/agent/src/main.ts and apps/hub/src/app.ts. Flag
ad-hoc singletons, app-local service registries, and dependencies hand-wired inside route handlers
or React components.

## scout-shared-contracts

- Severity: high
- Applies to: `apps/**`, `packages/shared/**`, `packages/plugin-sdk/**`

Cross-runtime payload and result shapes live in packages/shared or packages/plugin-sdk. Flag new
system, alert, terminal, operator, or plugin contracts declared inside an app when a shared schema
or exported type should own them.

## scout-rest-vs-rpc

- Severity: high
- Applies to: `apps/hub/**`, `apps/agent/**`, `apps/web/**`, `packages/shared/src/rpc/**`

REST in apps/hub/src/routes.ts is bootstrap and diagnostics. Live browser and agent traffic goes
through the shared RPC groups (browser to hub, agent to hub, hub to agent) and the hub, agent, and
web RPC layers. Flag new websocket behavior added in routes.ts or as a bespoke browser socket.

## scout-plugin-surface

- Severity: high
- Applies to: `packages/plugin-sdk/**`, `packages/plugin-docker/**`, `packages/plugin-edge/**`,
  `packages/plugin-k8s/**`, `packages/plugin-systemd/**`

A plugin's manifest.ts and contracts.ts are its public surface. Plugin ids, actions, streams, and
permission names stay there. Flag duplicates that drift from the contract, and app-specific imports
inside package contracts.

## scout-deploy-generic

- Severity: high
- Applies to: `deploy/**`

deploy/ is a generic self-host kit: systemd unit templates, env examples, and a Caddyfile example.
Flag host-specific config, real tokens, audience tags, or site secrets committed under deploy/.
Examples stay placeholders.
