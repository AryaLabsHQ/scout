# node-server: systemd + nginx + redis. Exercises system, network, process,
# systemd, and smart collectors. Matches a typical application server.
FROM scout-e2e-base:latest

RUN apt-get update && apt-get install -y \
    nginx redis-server \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN systemctl enable nginx redis-server
