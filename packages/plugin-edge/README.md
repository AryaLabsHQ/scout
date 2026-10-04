# `@scout/plugin-edge`

`packages/plugin-edge` is Scout's read-only edge plugin. It reports cloudflared tunnel readiness and Caddy reverse-proxy health for a node, so the dashboard can show whether traffic can reach the machine.

## What it reads

| Source                         | Endpoint                                       | Reported                                                                                         |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| cloudflared `--metrics` server | `GET /ready`, `GET /metrics`                   | ready, ready edge connections, HA connections, requests, request errors, edge locations, version |
| Caddy admin API                | `GET /reverse_proxy/upstreams`, `GET /config/` | upstream request and failure counts; sites with their hosts, listen addresses, and upstreams     |

## Configuration

Set on the agent:

```bash
# Comma-separated `name=url` or `url`; `off` disables. Default: probe 127.0.0.1:20241.
SCOUT_EDGE_CLOUDFLARED_METRICS=agni-host=http://127.0.0.1:2002
# Default: probe 127.0.0.1:2019.
SCOUT_EDGE_CADDY_ADMIN=http://127.0.0.1:2019
```

## Key Entry Points

- [`src/plugin.ts`](./src/plugin.ts): canonical plugin entrypoint
- [`src/contracts.ts`](./src/contracts.ts): ids, env names, entity state schemas, and UI screen
- [`src/edge.ts`](./src/edge.ts): config, parsers, and the agent implementation

## Commands

```bash
bun run typecheck
bun run test
```
