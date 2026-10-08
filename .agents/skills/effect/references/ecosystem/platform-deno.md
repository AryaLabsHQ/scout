# Platform Deno

**Source:** `@effect/platform-deno`. At `effect@4.0.0` the files live under
`packages/platform/deno/src/`. npm name is `@effect/platform-deno` (first published at beta.103).
Requires Deno `>= 2.8.3`.

Use this adapter when the runtime is Deno and you want Effect-native layers for HTTP, filesystem,
terminal, workers, sockets, and command execution. Node, Bun, and browser each have their own
adapter docs.

## Minimal runtime wiring

```ts
import { DenoRuntime } from "@effect/platform-deno";
import { Effect } from "effect";

DenoRuntime.runMain(
  Effect.sync(() => {
    console.log("deno runtime ready");
  }),
);
```

## Common layers

| Module / Layer                                         | What it provides                   |
| ------------------------------------------------------ | ---------------------------------- |
| `DenoRuntime.runMain`                                  | Runtime entrypoint                 |
| `DenoServices.layer`                                   | Standard Deno services             |
| `DenoHttpServer.layer`                                 | Deno HTTP server                   |
| `DenoHttpClient.layer`                                 | Deno HTTP client                   |
| `DenoFileSystem`                                       | Deno filesystem                    |
| `DenoPath`                                             | Path utilities                     |
| `DenoTerminal`                                         | Terminal                           |
| `DenoWorker.layerPlatform` / `DenoWorker.layer(spawn)` | Worker platform and spawner layers |
| `DenoWorkerRunner.layer` / `layerMessagePort`          | Worker-side runner layers          |
| `DenoSocket.layerTcp` / `layerWebSocket`               | TCP and WebSocket sockets          |
| `DenoSocketServer`                                     | Node-shared TCP/Unix socket server |
| `DenoCrypto`                                           | Crypto                             |
| `DenoStdio`                                            | Stdio                              |

The source tree nests platform packages under `packages/platform/{node,bun,browser,deno}`. Cite the
npm package name in application code.

## Related

- [platform-node.md](platform-node.md)
- [platform-bun.md](platform-bun.md)
- [platform.md](platform.md)
