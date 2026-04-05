# node-docker: Docker-in-Docker for testing the Docker collector and
# management actions. Runs docker daemon under systemd inside the container.
FROM scout-e2e-base:latest

# Install Docker CE from the official repo
RUN apt-get update && apt-get install -y \
    apt-transport-https gnupg lsb-release \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y docker-ce docker-ce-cli containerd.io \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Use vfs storage driver — overlay can't nest inside Docker Desktop's overlay
# filesystem. vfs is slow but works reliably for testing.
RUN mkdir -p /etc/docker && \
    printf '{\n  "storage-driver": "vfs"\n}\n' > /etc/docker/daemon.json

RUN systemctl enable docker
