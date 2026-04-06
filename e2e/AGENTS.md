# E2E HARNESS

## OVERVIEW
`e2e/` is a local Docker-based multi-node lab for exercising Scout end-to-end. The hub runs on the host, containers mount the repo read-only at `/opt/scout`, and `.scout/` on the host holds pidfiles and agent logs.

## STRUCTURE
```text
e2e/
├── nodes/       # Dockerfiles for base, server, k3s, docker, minimal profiles
├── scripts/     # up/down/logs/exec helpers and agent bootstrap scripts
├── fixtures/    # sample workloads, including k3s test manifests
└── README.md    # topology, runtime state, limitations, usage
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Bring nodes up/down | `scripts/up.sh`, `scripts/down.sh` | Hub must already be running on the host |
| Inspect agent logs | `scripts/logs.sh`, repo-root `.scout/*.log` | PID and log files are shared with the host |
| Exec into a node | `scripts/exec.sh` | Useful for K8s and Docker capability debugging |
| Node image behavior | `nodes/*.Dockerfile` | Each profile enables different collectors/capabilities |
| K3s sample workload | `fixtures/k3s/test-app.yaml` | Used to exercise workload views |

## CONVENTIONS
- Host ports are fixed in the docs: web at `:3000`, hub at `:3001`.
- The source tree is mounted read-only into containers; agents run directly from the mounted checkout.
- `.scout/` is runtime state, not checked-in product code.

## ANTI-PATTERNS
- Do not treat the harness as production-like security posture; containers are privileged and host-coupled.
- Do not assume the K8s collector is fully working; the README documents known TLS/parser limitations.
- Do not optimize for the inner Docker daemon's `vfs` driver; it exists for correctness in local nested Docker only.
