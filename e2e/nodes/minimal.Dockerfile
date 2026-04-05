# node-minimal: bare Ubuntu + systemd only. Exercises the capability
# auto-discovery code path where most collectors detect as unavailable.
# No nginx, no redis, no k3s, no docker — just the base system.
FROM scout-e2e-base:latest
