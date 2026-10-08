# Platform Node Shared

**Source:** `@effect/platform-node-shared` - see
`~/Developer/effect/packages/platform/node-shared/src/`

At `effect@4.0.0` the same files live under `packages/platform/node-shared/src/`.

`@effect/platform-node-shared` provides shared Node-oriented platform modules used by both
`@effect/platform-node` and `@effect/platform-bun`.

## When You Should Care

- Most app code: you usually do **not** import this package directly; use `@effect/platform-node` or
  `@effect/platform-bun`.
- Direct usage makes sense when building custom runtime/context layers or reusable libraries that
  need shared Node/Bun implementations.

## Common Modules

| Module                                                           | What it provides                           |
| ---------------------------------------------------------------- | ------------------------------------------ |
| `NodeRuntime.runMain`                                            | Runtime entrypoint (shared Node/Bun entry) |
| `NodeFileSystem.layer`                                           | File system service implementation         |
| `NodePath.layer` / `NodePath.layerPosix` / `NodePath.layerWin32` | Path utilities with platform variants      |
| `NodeTerminal.make` / `NodeTerminal.layer`                       | Terminal service                           |
| `NodeChildProcessSpawner.layer`                                  | Command execution                          |
| `NodeSocket.layerNet` / `NodeSocket.layerTls`                    | Node TCP/TLS socket clients                |
| `NodeSocketServer.layer`                                         | Node socket server                         |
| `NodeStream`                                                     | Stream utilities (sink, source)            |
| `NodeClusterSocket.layer`                                        | Cluster socket layer                       |
| `NodeChildProcessSpawner`                                        | Child process spawning                     |

## Direct Install (Only If Needed)

```bash
npm install effect @effect/platform-node-shared
```

## Notes

- For Node.js usage, target a modern LTS runtime (Node 18+ recommended, Node 20+ preferred).
- For Bun usage, Bun 1.0+ recommended.
- The package depends on the root `effect` package and shared WebSocket support; install the
  platform-specific package that owns the runtime service you need.
- In v4, the HTTP stack (`HttpRouter`, `HttpServer`, `HttpClient`) moved to `effect/http` and is not
  part of this package.
