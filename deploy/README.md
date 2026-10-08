# Self-hosting Scout

This kit runs Scout as `systemd --user` units on Linux: the hub and web dashboard on one host behind
a reverse proxy and Cloudflare Access, and an agent on every host you want to watch.

```
browser -> Cloudflare Access -> reverse proxy (Caddy) on the hub host
  /api/*, /ws/*, /health -> scout-hub 127.0.0.1:3901   (/ws/rpc/agent -> 404)
  everything else        -> scout-web 127.0.0.1:3900

scout-agent (hub host)    -> ws://127.0.0.1:3901/ws/rpc/agent             (Bearer <its token>)
scout-agent (other hosts) -> wss://hub.example.internal:3902/ws/rpc/agent (private network only)
```

| File                                         | Install to                                                     |
| -------------------------------------------- | -------------------------------------------------------------- |
| `systemd/scout-{hub,web,agent}.service`      | `~/.config/systemd/user/`                                      |
| `env/{hub,web,agent}.env.example`            | `~/.config/scout/{hub,web,agent}.env` (`0600`)                 |
| `caddy/Caddyfile.example`                    | your Caddyfile                                                 |
| `k8s/rbac.yaml`                              | your cluster (`kubectl apply`), only if you use the k8s plugin |
| `polkit/50-scout-unit-actions.rules.example` | `/etc/polkit-1/rules.d/` on each agent host, optional          |

The hub keeps its SQLite database in `~/.local/state/scout/scout.db` (the unit's
`StateDirectory=scout`), and operator sessions in `scout-operator.db` next to it.

The units assume a checkout at `~/scout` and Bun at `~/.bun/bin/bun`. Edit the paths if yours
differ. The hub and agent run from source and the web from its nitro build (`apps/web/.output`).
Enable lingering (`loginctl enable-linger $USER`) so user units start at boot without a login.

## Prerequisites

1. **Cloudflare Access application** for the dashboard host name (for example `scout.example.com`),
   with a policy for the people allowed in. Create it before the host name is routable, so the
   dashboard is never reachable unauthenticated. Copy its **Application Audience (AUD) tag** for
   `SCOUT_ACCESS_AUD` and note your team domain (`your-team.cloudflareaccess.com`).
2. **Route to the reverse proxy**, for example a Cloudflare Tunnel ingress rule
   `scout.example.com -> http://127.0.0.1:80` plus its DNS route.
3. **Caddy**: merge the dashboard site from `caddy/Caddyfile.example`, run `caddy validate`, and
   reload Caddy. Caddy answers 502 until the hub and web are up.

The hub verifies the Access JWT itself, so a request that bypasses Access is still refused.

## Build

```sh
git clone https://github.com/AryaLabsHQ/scout.git ~/scout
cd ~/scout && git checkout --detach <release-sha>
bun install --frozen-lockfile
bun run --cwd apps/web build
```

Hosts that run only an agent skip the web build.

## Install the hub, web and local agent

Configuration (keep secrets out of Git; env files are `0600`):

```sh
cd ~/scout
install -d -m 700 ~/.config/scout
install -m 600 deploy/env/hub.env.example   ~/.config/scout/hub.env
install -m 600 deploy/env/web.env.example   ~/.config/scout/web.env
install -m 600 deploy/env/agent.env.example ~/.config/scout/agent.env
token=$(openssl rand -hex 32)
sed -i "s/^SCOUT_AGENT_TOKENS=$/SCOUT_AGENT_TOKENS=$(hostname)=$token/" ~/.config/scout/hub.env
sed -i "s/^SCOUT_TOKEN=$/SCOUT_TOKEN=$token/" ~/.config/scout/agent.env
unset token
$EDITOR ~/.config/scout/hub.env   # set SCOUT_ACCESS_TEAM_DOMAIN and SCOUT_ACCESS_AUD
```

Database schema (back up first when upgrading):

```sh
install -d -m 700 ~/.local/state/scout
cp -a ~/.local/state/scout/scout.db ~/.local/state/scout/scout.db.bak-$(date +%F) 2>/dev/null || true
# Operator sessions: stop the hub first (one process owns this file); pi-durable migrates it on open.
cp -a ~/.local/state/scout/scout-operator.db ~/.local/state/scout/scout-operator.db.bak-$(date +%F) 2>/dev/null || true
SCOUT_DB_PATH=$HOME/.local/state/scout/scout.db bun run --cwd apps/hub db:push
```

Units:

```sh
install -d ~/.config/systemd/user
install -m 644 deploy/systemd/scout-*.service ~/.config/systemd/user/
systemd-analyze --user verify ~/.config/systemd/user/scout-*.service
systemctl --user daemon-reload
systemctl --user enable --now scout-hub.service
systemctl --user enable --now scout-web.service scout-agent.service
```

If the host runs no Kubernetes cluster, remove the agent unit's `KUBECONFIG` line and set
`SCOUT_PLUGINS_DISABLE` in `agent.env` (see [Agent plugins](#agent-plugins)).

## Verify

```sh
systemctl --user status scout-hub scout-web scout-agent --no-pager
journalctl --user -u scout-hub -n 50 --no-pager        # "Browser auth: Cloudflare Access", no errors
curl -fsS 127.0.0.1:3901/health                         # status ok, connectedAgents: 1
curl -s -o /dev/null -w '%{http_code}\n' 127.0.0.1:3901/api/systems   # 401 (no Access JWT)
curl -s -o /dev/null -w '%{http_code}\n' https://scout.example.com/   # 302 to the Access login
```

Then sign in through Access and confirm the dashboard lists the host with live metrics. A
state-changing action logs `rpc audit` with the signed-in email:
`journalctl --user -u scout-hub | grep 'rpc audit'`.

The hub refuses to start (and the unit stops after five restarts) when `SCOUT_AGENT_TOKENS`,
`SCOUT_ACCESS_TEAM_DOMAIN`, or `SCOUT_ACCESS_AUD` is missing or invalid; the journal names the
variable.

## Remote agents

Agents on other hosts reach the hub over a private network, never through the public dashboard
site. The optional second site in `caddy/Caddyfile.example` routes only `/ws/rpc/agent`, only from
private addresses, on its own port. Merge it on the hub host, adjust the host name and address
ranges, and reload Caddy. Over Tailscale, Caddy can serve the `*.ts.net` certificate for the hub's
tailnet name, so agents connect with `wss://`.

For each new host:

1. On the hub host, give it a token and restart the hub:

   ```sh
   token=$(openssl rand -hex 32)
   sed -i "s/^SCOUT_AGENT_TOKENS=.*/&,node-2=$token/" ~/.config/scout/hub.env
   systemctl --user restart scout-hub
   ```

   Copy the token to the new host without printing it, for example by piping it over SSH into the
   new host's `~/.config/scout/agent.env`.

2. On the new host, clone and install at the same commit as the hub (agent and hub share wire
   contracts), then install the agent alone:

   ```sh
   install -d -m 700 ~/.config/scout ~/.config/systemd/user
   install -m 600 deploy/env/agent.env.example ~/.config/scout/agent.env
   # Set SCOUT_TOKEN, SCOUT_HOSTNAME=node-2, and SCOUT_HUB_URL=wss://hub.example.internal:3902
   install -m 644 deploy/systemd/scout-agent.service ~/.config/systemd/user/
   systemctl --user daemon-reload && systemctl --user enable --now scout-agent
   ```

3. Check `journalctl --user -u scout-agent` for `HubConnection: connected`, and the hub's
   `/health` for one more connected agent.

The hub accepts each token only for its own hostname, so a compromised host cannot register as
another. To revoke a host, remove its entry from `SCOUT_AGENT_TOKENS` and restart the hub.

## Agent plugins

The agent loads every plugin under `SCOUT_PLUGIN_DIR` and skips those whose tools are missing.
`SCOUT_PLUGINS_DISABLE` turns plugins off by id on one host, for example the Kubernetes plugin on a
host that has `kubectl` but no cluster. See `apps/agent/README.md` for the accepted ids.

## Kubernetes RBAC

The k8s plugin runs `kubectl` with the agent's environment, so `KUBECONFIG` sets its cluster
identity. Give it the scoped ServiceAccount in `k8s/rbac.yaml`, never a cluster-admin kubeconfig.
The manifest creates namespace `scout`, ServiceAccount `scout-agent`, and a cluster-wide
`scout-agent` ClusterRole matching what `packages/plugin-k8s` runs:

| kubectl call (plugin)                                                                                        | Grant                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `get namespaces/nodes/pods/services/events`, `deployments.apps`, `jobs.batch`, `ingresses` (collection)      | get, list, watch                                                                                                           |
| `describe <namespace/node/pod/deployment/statefulset/daemonset/service/ingress/job/cronjob>`, `cluster-info` | get, list, watch on those plus replicasets, endpoints, endpointslices, resourcequotas, limitranges, `events.k8s.io` events |
| `logs <pod>` (pod-logs stream)                                                                               | `pods/log`: get                                                                                                            |
| `scale <deployment/statefulset>` (scale-workload)                                                            | `deployments/scale`, `statefulsets/scale`: get, patch, update                                                              |
| `delete pod` (restart-pod, delete-pod)                                                                       | `pods`: delete                                                                                                             |

There is no access to Secrets or ConfigMaps. The plugin also offers scale-workload on DaemonSets,
Jobs, and CronJobs; Kubernetes cannot scale those, so they fail regardless of RBAC.

Build the kubeconfig from a TokenRequest token and the public `kube-root-ca.crt` ConfigMap, so no
Secret is created or read. Run this as a cluster admin; set `server` to your API server:

```sh
kubectl apply -f deploy/k8s/rbac.yaml
umask 077
kubectl -n scout get configmap kube-root-ca.crt -o jsonpath='{.data.ca\.crt}' > /tmp/scout-ca.crt
token=$(kubectl -n scout create token scout-agent --duration=8760h)
export KUBECONFIG=$HOME/.config/scout/kubeconfig
kubectl config set-cluster scout-cluster --server=https://127.0.0.1:6443 \
  --certificate-authority=/tmp/scout-ca.crt --embed-certs=true
kubectl config set-credentials scout-agent --token="$token"
kubectl config set-context scout --cluster=scout-cluster --user=scout-agent
kubectl config use-context scout
chmod 600 "$KUBECONFIG"; rm /tmp/scout-ca.crt; unset token
kubectl get pods -A >/dev/null && echo read-ok
kubectl auth can-i get secrets -A          # expect: no
kubectl auth can-i delete pods -n default  # expect: yes
unset KUBECONFIG
```

The API server may cap `--duration`; the token then expires sooner, so rebuild the kubeconfig
before it does. The token is not bound to an object and stays valid until it expires or the
ServiceAccount is deleted. To revoke every token, delete the ServiceAccount
(`kubectl -n scout delete serviceaccount scout-agent`), then re-apply `rbac.yaml` and rebuild the
kubeconfig.

## systemd plugin permissions

The agent runs as your user with `NoNewPrivileges=yes` and never uses sudo. It manages that user's
own units with `systemctl --user`, which needs no extra permission. Actions on system units run
`systemctl --no-ask-password`, so without a polkit grant they fail with `permission-denied`.

To allow some, install `polkit/50-scout-unit-actions.rules.example` as
`/etc/polkit-1/rules.d/50-scout-unit-actions.rules` and set its user and unit list. It permits
start, stop, restart and reload of the listed units only; enable, disable and `daemon-reload` stay
denied. Collecting units, timers and journals needs no grant (journals need the `adm` or
`systemd-journal` group).

Restarting `scout-agent` or `scout-hub` from Scout cuts Scout's own connection until the unit is
back.

## Upgrade

Upgrade the hub host and every agent host to the same commit:

```sh
cd ~/scout && git fetch origin && git checkout --detach <new-sha>
bun install --frozen-lockfile
bun run --cwd apps/web build            # hub host only
# hub host: back up the database, then run db:push as in Install
install -m 644 deploy/systemd/scout-*.service ~/.config/systemd/user/ && systemctl --user daemon-reload
systemctl --user restart scout-hub scout-web scout-agent   # agent hosts: scout-agent only
```

Skip the unit copy if you keep customized units elsewhere.

## Rollback

- **Previous version**: check out the previous commit, rebuild the web, restore the database
  backup if the schema changed, and restart the units.
- **Take Scout offline**: `systemctl --user disable --now scout-agent scout-web scout-hub`. Behind
  Access, Caddy then answers 502; nothing else is exposed.
- **Remove entirely**: also remove the Caddy sites and reload, remove the tunnel route and DNS
  record, `kubectl delete -f deploy/k8s/rbac.yaml`, the polkit rule, and `~/.config/scout` and
  `~/.local/state/scout`.
