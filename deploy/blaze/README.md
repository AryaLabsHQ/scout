# Scout agent on Blaze

Blaze runs only a Scout agent. It reports to the hub on Agni over the tailnet:

```
scout-agent (blaze, user unit)
  -> wss://agni.jaguar-pride.ts.net:3902/ws/rpc/agent   (Bearer blaze's agent token)
     Agni Caddy tailnet listener (dotfiles), /ws/rpc/agent only, tailnet addresses only
     -> scout-hub 127.0.0.1:3901
```

The hub's `SCOUT_AGENT_TOKENS` holds one token per host, and it accepts Blaze's token only for the
hostname `blaze`. Blaze has no cluster and no Caddy. `KUBECONFIG=/dev/null` keeps the k8s plugin
off any other cluster, but because `kubectl` is installed it reports degraded and its collections
fail until plugins can be disabled per agent. The edge plugin reads only the `blaze-host` tunnel's metrics on
`127.0.0.1:2002`. Unit actions on system units use the Blaze polkit allowlist in dotfiles
(`machines/blaze/system`), which covers `cloudflared-blaze-host` and `fail2ban`; user units need no
polkit.

| File                          | Installed to                                 |
| ----------------------------- | -------------------------------------------- |
| `systemd/scout-agent.service` | `~/.config/systemd/user/scout-agent.service` |
| `env/agent.env.example`       | `~/.config/scout/agent.env` (`0600`)         |

## Prerequisites

- Bun at `~/.bun/bin/bun` and lingering for `ubuntu` (`loginctl enable-linger ubuntu`).
- Agni's Caddyfile has the `agni.jaguar-pride.ts.net:3902` site (dotfiles `machines/agni/system`).
- The dotfiles Blaze system files are applied (`sudo ./shared/bin/dot system apply`), for the
  polkit rule.

## Install

On Agni, add a token for Blaze to the hub and restart it:

```sh
token=$(openssl rand -hex 32)
# Append ",blaze=$token" to SCOUT_AGENT_TOKENS in ~/.config/scout/hub.env.
sed -i "s/^SCOUT_AGENT_TOKENS=.*/&,blaze=$token/" ~/.config/scout/hub.env
systemctl --user restart scout-hub
```

Copy the token to Blaze without printing it (for example, pipe it over SSH into the env file below),
then on Blaze:

```sh
git clone git@github.com:AryaLabsHQ/scout.git ~/Developer/AryaLabsHQ/scout
cd ~/Developer/AryaLabsHQ/scout && git checkout --detach <sha deployed on Agni>
bun install --frozen-lockfile
install -d -m 700 ~/.config/scout
install -d ~/.config/systemd/user
install -m 600 deploy/blaze/env/agent.env.example ~/.config/scout/agent.env
# Set SCOUT_TOKEN to Blaze's token.
install -m 644 deploy/blaze/systemd/scout-agent.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now scout-agent
```

## Verify

```sh
journalctl --user -u scout-agent -n 20 --no-pager   # Blaze: connected, no auth errors
curl -fsS http://127.0.0.1:3901/health               # Agni: connectedAgents counts blaze
```

Then confirm `blaze` appears on `https://scout.arya.sh` with live metrics.

## Upgrade

Keep Blaze on the same commit as Agni, since the agent and hub share wire contracts:

```sh
cd ~/Developer/AryaLabsHQ/scout && git fetch origin && git checkout --detach <sha>
bun install --frozen-lockfile
install -m 644 deploy/blaze/systemd/scout-agent.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user restart scout-agent
```

## Revoke

Remove the `blaze=` entry from `SCOUT_AGENT_TOKENS` on Agni and restart the hub. Blaze's agent is
then refused at the upgrade.
