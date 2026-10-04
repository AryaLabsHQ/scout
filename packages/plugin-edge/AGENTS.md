# EDGE PLUGIN

## OVERVIEW

`packages/plugin-edge` reports the health of what sits in front of a node: cloudflared tunnel connectors (from their metrics server) and Caddy (from its admin API). It is read-only: no actions, no streams, and only HTTP GETs.

## STRUCTURE

```text
packages/plugin-edge/src/
├── contracts.ts   # ids, env names, defaults, entity state schemas, web screen
├── manifest.ts    # published plugin metadata and permissions
├── edge.ts        # config, parsers, readers, detect/collect
├── agent.ts       # agent runtime adapter
├── hub.ts / web.ts
└── index.ts
```

## WHERE TO LOOK

| Task                                | Location                         | Notes                                                                        |
| ----------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| Entity kinds, metric ids, env names | `src/contracts.ts`               | `edge.tunnel`, `edge.proxy`; `EdgeTunnelStateSchema`, `EdgeProxyStateSchema` |
| Endpoint config                     | `src/edge.ts` (`readEdgeConfig`) | `SCOUT_EDGE_CLOUDFLARED_METRICS`, `SCOUT_EDGE_CADDY_ADMIN`                   |
| cloudflared / Caddy parsing         | `src/edge.ts`                    | Prometheus text, `/ready`, `/reverse_proxy/upstreams`, `/config/`            |

## CONVENTIONS

- Endpoints come from the agent's environment as comma-separated `name=url` or `url`; `off` disables a source. Unset probes the upstream defaults (cloudflared `127.0.0.1:20241`, Caddy `127.0.0.1:2019`) and drops them silently when they do not answer. An endpoint set explicitly is reported as `unreachable` when it does not answer.
- Detect returns `unsupported` when nothing answered and nothing was configured, so hosts without cloudflared or Caddy show no edge plugin.
- Entity ids are endpoint names; all entities in one collection share the collection timestamp.
- From Caddy's `/config/`, keep only site hosts, listen addresses, and upstream dials. The config can hold credentials (DNS-provider tokens); never store or report the rest of it. Likewise, drop cloudflared's `connectorId`.

## ANTI-PATTERNS

- Do not send anything but GET to the Caddy admin API; any other method changes the running config.
- Do not add actions that restart cloudflared or Caddy here; those are systemd units and belong to the systemd plugin.
