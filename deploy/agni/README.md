# Scout on Agni

Runbook for running Scout on Agni as three `systemd --user` units behind Caddy and Cloudflare
Access at `https://scout.arya.sh`.

```
browser -> Cloudflare Access (app "Scout") -> tunnel agni-host -> Caddy 127.0.0.1:80
  Caddy http://scout.arya.sh:
    /api/*, /ws/*, /health -> scout-hub 127.0.0.1:3901   (/ws/rpc/agent -> 404)
    everything else        -> scout-web 127.0.0.1:3900
scout-agent -> ws://127.0.0.1:3901/ws/rpc/agent (Bearer SCOUT_TOKEN)
```

| Asset | Installed to |
|-------|--------------|
| `systemd/scout-{hub,web,agent}.service` | `~/.config/systemd/user/` |
| `env/{hub,web,agent}.env.example` | `~/.config/scout/{hub,web,agent}.env` |
| `caddy/scout.caddy` | dotfiles Caddyfile (`machines/agni`) |
| `k8s/rbac.yaml` | k3s (`sudo kubectl apply`) |
| agent kubeconfig | `~/.config/scout/kubeconfig` |
| SQLite database | `~/.local/state/scout/scout.db` (unit `StateDirectory=scout`) |
| Operator sessions (pi-durable SQLite) | `~/.local/state/scout/scout-operator.db`, next to `scout.db`; pi-durable owns its schema |

The units run the checkout at `/home/ubuntu/Developer/AryaLabsHQ/scout` with `~/.bun/bin/bun`:
the hub and agent from source, the web from its nitro build (`apps/web/.output`). The user
manager lingers on Agni (`loginctl show-user ubuntu -p Linger` is `yes`), so the units start at
boot.

## Prerequisites (in this order)

1. **Cloudflare Access application** "Scout" for `scout.arya.sh`, with the Saatvik allow policy.
   It must exist before step 2 so the hostname is never reachable unauthenticated. Copy its
   **Application Audience (AUD) tag** for `SCOUT_ACCESS_AUD`. The team domain is
   `aryalabs.cloudflareaccess.com`.
2. **Tunnel route**: an `agni-host` ingress rule `scout.arya.sh -> http://127.0.0.1:80` (dotfiles
   cloudflared config), then the DNS route:
   `cloudflared tunnel route dns agni-host scout.arya.sh`.
3. **Caddy**: add `caddy/scout.caddy` to the dotfiles Caddyfile, then `caddy validate` and reload
   Caddy through the dotfiles workflow.

Steps 2 and 3 can land before the units run; Caddy answers 502 until the hub and web are up.

## Build

```sh
cd ~/Developer/AryaLabsHQ/scout
git fetch origin && git checkout --detach <release-sha>
bun install --frozen-lockfile
bun run --cwd apps/web build
```

## Install

Configuration (no secrets in git; both env files are `0600`):

```sh
install -d -m 700 ~/.config/scout
install -m 600 deploy/agni/env/hub.env.example   ~/.config/scout/hub.env
install -m 600 deploy/agni/env/web.env.example   ~/.config/scout/web.env
install -m 600 deploy/agni/env/agent.env.example ~/.config/scout/agent.env
token=$(openssl rand -hex 32)
sed -i "s/^SCOUT_TOKEN=$/SCOUT_TOKEN=$token/" ~/.config/scout/hub.env ~/.config/scout/agent.env
$EDITOR ~/.config/scout/hub.env   # set SCOUT_ACCESS_AUD
```

Database schema (back up first when upgrading):

```sh
install -d -m 700 ~/.local/state/scout
cp -a ~/.local/state/scout/scout.db ~/.local/state/scout/scout.db.bak-$(date +%F) 2>/dev/null || true
# Operator sessions: stop the hub first (one process owns this file); pi-durable migrates it on open.
cp -a ~/.local/state/scout/scout-operator.db ~/.local/state/scout/scout-operator.db.bak-$(date +%F) 2>/dev/null || true
SCOUT_DB_PATH=$HOME/.local/state/scout/scout.db bun run --cwd apps/hub db:push
```

Kubernetes identity for the agent's k8s plugin (see [RBAC](#kubernetes-rbac)):

```sh
sudo kubectl apply -f deploy/agni/k8s/rbac.yaml
umask 077
# The CA comes from the public kube-root-ca.crt ConfigMap and the token from the
# TokenRequest API, so no Secret is created or read.
sudo kubectl -n scout get configmap kube-root-ca.crt -o jsonpath='{.data.ca\.crt}' > /tmp/scout-ca.crt
token=$(sudo kubectl -n scout create token scout-agent --duration=87600h)
export KUBECONFIG=$HOME/.config/scout/kubeconfig
kubectl config set-cluster agni --server=https://127.0.0.1:6443 \
  --certificate-authority=/tmp/scout-ca.crt --embed-certs=true
kubectl config set-credentials scout-agent --token="$token"
kubectl config set-context scout --cluster=agni --user=scout-agent
kubectl config use-context scout
chmod 600 "$KUBECONFIG"; rm /tmp/scout-ca.crt; unset token
kubectl get pods -A >/dev/null && echo read-ok
kubectl auth can-i get secrets -A    # expect: no
kubectl auth can-i delete pods -n default   # expect: yes
unset KUBECONFIG
```

`kubectl` on Agni is the k3s binary; without `KUBECONFIG` it falls back to the root-only
`/etc/rancher/k3s/k3s.yaml`. The agent unit sets `KUBECONFIG`, and the k8s plugin's `kubectl`
child processes inherit it.

Units:

```sh
install -m 644 deploy/agni/systemd/scout-*.service ~/.config/systemd/user/
systemd-analyze --user verify ~/.config/systemd/user/scout-*.service
systemctl --user daemon-reload
systemctl --user enable --now scout-hub.service
systemctl --user enable --now scout-web.service scout-agent.service
```

## Verify

```sh
systemctl --user status scout-hub scout-web scout-agent --no-pager
journalctl --user -u scout-hub -n 50 --no-pager        # "Browser auth: Cloudflare Access", no errors
curl -s 127.0.0.1:3901/health                           # status ok, connectedAgents: 1
curl -s -o /dev/null -w '%{http_code}\n' 127.0.0.1:3901/api/systems   # 401 (no Access JWT)
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: scout.arya.sh' 127.0.0.1/health   # 200 via Caddy
curl -s -o /dev/null -w '%{http_code}\n' https://scout.arya.sh/   # 302 to Access login
```

Then open `https://scout.arya.sh`, sign in through Access, and confirm the dashboard lists `agni`
with live metrics. A state-changing action logs `rpc audit` with your email:
`journalctl --user -u scout-hub | grep 'rpc audit'`.

The hub refuses to start (and the unit stops after five restarts) when `SCOUT_TOKEN`,
`SCOUT_ACCESS_TEAM_DOMAIN`, or `SCOUT_ACCESS_AUD` is missing; the journal names the variable.

## Upgrade

```sh
cd ~/Developer/AryaLabsHQ/scout && git fetch origin && git checkout --detach <new-sha>
bun install --frozen-lockfile
bun run --cwd apps/web build
# back up the database, then run db:push as in Install
install -m 644 deploy/agni/systemd/scout-*.service ~/.config/systemd/user/ && systemctl --user daemon-reload
systemctl --user restart scout-hub scout-web scout-agent
```

**Migrating from the token Secret.** Older revisions of `k8s/rbac.yaml` created a
`scout-agent-token` Secret holding a non-expiring token. Re-applying the manifest does not
delete that Secret. Switch the agent to a TokenRequest token first, then delete the Secret, so
Kubernetes collection never breaks:

```sh
# 1. Rebuild ~/.config/scout/kubeconfig with the TokenRequest commands in Install,
#    including the read-ok and can-i checks.
# 2. Restart the agent on the new kubeconfig.
systemctl --user restart scout-agent
# 3. Only then revoke the old token.
sudo kubectl -n scout delete secret scout-agent-token --ignore-not-found
```

Deleting the Secret revokes its token; after step 1 nothing uses it.

## Rollback

- **Previous version**: check out the previous SHA, rebuild the web, restore the database backup
  if the schema changed, and restart the three units.
- **Take Scout offline**: `systemctl --user disable --now scout-agent scout-web scout-hub`. Caddy
  then answers 502 behind Access; nothing else is exposed.
- **Remove entirely**: also remove the Caddy block and reload, remove the tunnel ingress rule and
  the `scout.arya.sh` DNS record, `sudo kubectl delete -f deploy/agni/k8s/rbac.yaml`, and delete
  `~/.config/scout` and `~/.local/state/scout`.

## Kubernetes RBAC

`k8s/rbac.yaml` creates namespace `scout`, ServiceAccount `scout-agent`,
and a cluster-wide `scout-agent` ClusterRole matching what `packages/plugin-k8s` runs:

| kubectl call (plugin) | Grant |
|-----------------------|-------|
| `get namespaces/nodes/pods/services/events`, `deployments.apps`, `jobs.batch`, `ingresses` (collection) | get, list, watch |
| `describe <namespace/node/pod/deployment/statefulset/daemonset/service/ingress/job/cronjob>`, `cluster-info` | get, list, watch on those plus replicasets, endpoints, endpointslices, resourcequotas, limitranges, `events.k8s.io` events |
| `logs <pod>` (pod-logs stream) | `pods/log`: get |
| `scale <deployment/statefulset>` (scale-workload) | `deployments/scale`, `statefulsets/scale`: get, patch, update |
| `delete pod` (restart-pod, delete-pod) | `pods`: delete |

There is no access to Secrets or ConfigMaps. The plugin also offers scale-workload on
DaemonSets, Jobs, and CronJobs; Kubernetes cannot scale those, so they fail regardless of RBAC.
The kubeconfig token comes from the TokenRequest API and is valid for 10 years (k3s does not cap
`--duration`). It is not bound to an object, so it stays valid until it expires or the
`scout-agent` ServiceAccount is deleted. To rotate it, delete and re-apply the ServiceAccount
(`sudo kubectl -n scout delete serviceaccount scout-agent`, then apply `rbac.yaml` again), which
revokes every token issued for it, then rebuild the kubeconfig.

## systemd plugin on Agni

The agent runs as `ubuntu` with `NoNewPrivileges=yes` and never uses sudo. Mutations run
`systemctl --no-ask-password`, so polkit answers at once instead of prompting for a password.

A polkit rule in dotfiles (`machines/agni/system/files/etc/polkit-1/rules.d/50-scout-unit-actions.rules`)
lets `ubuntu` start, stop, restart and reload an allowlist of host units: `caddy`,
`cloudflared-agni-host`, `fail2ban`, `glances`, `vnstat`, `restic-backup.service` and
`restic-backup.timer`. Add a unit there to make it actionable from Scout.

| Works as `ubuntu` | Fails with `permission-denied` |
|-------------------|--------------------------------|
| Collecting system service units (`systemctl list-units`, `show`) | Actions on units outside the polkit allowlist (`k3s`, `tailscaled`, `ssh`, `postgresql`, ...) |
| start, stop, restart, reload of allowlisted units | enable and disable of any system unit |
| Unit logs (`journalctl -u`; `ubuntu` is in `adm`) | `daemon-reload` |
| Reading unit files under `/etc` and `/usr/lib` | Writing unit files to system paths |

The plugin manages system units only; user units such as `scout-hub.service` are not
collected. Use a host shell with sudo for everything outside the allowlist.
