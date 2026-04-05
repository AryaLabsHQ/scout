FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Core tools + systemd. smartmontools gives us the SMART collector code path.
RUN apt-get update && apt-get install -y \
    systemd systemd-sysv \
    curl wget unzip ca-certificates \
    htop procps net-tools iproute2 \
    smartmontools \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Bun for running the agent directly from source
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Remove systemd units that don't work in containers
RUN rm -f /lib/systemd/system/multi-user.target.wants/* \
    /etc/systemd/system/*.wants/* \
    /lib/systemd/system/local-fs.target.wants/* \
    /lib/systemd/system/sockets.target.wants/*udev* \
    /lib/systemd/system/sockets.target.wants/*initctl* \
    /lib/systemd/system/basic.target.wants/* \
    /lib/systemd/system/anaconda.target.wants/* \
    /lib/systemd/system/plymouth* \
    /lib/systemd/system/systemd-update-utmp*

VOLUME ["/sys/fs/cgroup"]
STOPSIGNAL SIGRTMIN+3

CMD ["/sbin/init"]
