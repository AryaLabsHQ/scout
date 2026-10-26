# Platform Deno

**Source:** `@effect/platform-deno` - see `~/Developer/effect/packages/platform/deno/src/`. Requires
Deno `>= 2.9.3`; earlier 2.8.3 to 2.9.2 releases panic when an HTTP/2 client cancels a request while
a `DenoHttpServer` handler is still running.

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

| Module / Layer                                         | What it provides                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `DenoRuntime.runMain`                                  | Runtime entrypoint                                                                |
| `DenoServices.layer`                                   | Standard Deno services                                                            |
| `DenoHttpServer.layer`                                 | Deno HTTP server                                                                  |
| `DenoHttpClient.layer` / `layerOptions(options)`       | Deno HTTP client; options are `Deno.createHttpClient` settings (Unix socket, TLS) |
| `DenoFileSystem`                                       | Deno filesystem                                                                   |
| `DenoPath`                                             | Path utilities                                                                    |
| `DenoTerminal`                                         | Terminal                                                                          |
| `DenoWorker.layerPlatform` / `DenoWorker.layer(spawn)` | Worker platform and spawner layers                                                |
| `DenoWorkerRunner.layer` / `layerMessagePort`          | Worker-side runner layers                                                         |
| `DenoSocket.layerTcp` / `layerWebSocket`               | TCP and WebSocket sockets                                                         |
| `DenoSocketServer`                                     | Node-shared TCP/Unix socket server                                                |
| `DenoCrypto`                                           | Crypto                                                                            |
| `DenoStdio`                                            | Stdio                                                                             |

The source tree nests platform packages under `packages/platform/{node,bun,browser,deno}`. Cite the
npm package name in application code.

## Related

- [platform-node.md](platform-node.md)
- [platform-bun.md](platform-bun.md)
- [platform.md](platform.md)
