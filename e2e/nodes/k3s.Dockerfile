# node-k3s: single-node k3s (server+agent combined) running under systemd.
# Built on the shared base so we get Ubuntu + systemd + bun + smartmontools,
# then k3s is installed via the official installer. This mirrors how k3s is
# actually deployed on a real node.
FROM scout-e2e-base:latest

# Install k3s. The installer creates the systemd unit + enables it (via
# symlink) and then tries to daemon-reload, which fails during docker build
# because systemd isn't PID 1. We ignore that trailing failure — the enable
# already succeeded. When the container boots, systemd will pick up the unit.
RUN curl -sfL https://get.k3s.io | \
    INSTALL_K3S_SKIP_START=true \
    INSTALL_K3S_SKIP_SELINUX_RPM=true \
    INSTALL_K3S_EXEC="server --disable=traefik --disable=servicelb --disable=metrics-server" \
    sh - || true

# Verify the unit file and symlink were created
RUN test -f /etc/systemd/system/k3s.service && \
    test -L /etc/systemd/system/multi-user.target.wants/k3s.service
