# Workers

`effect/workers` is the platform-neutral worker protocol used by the Node, Bun, Deno, and browser
adapters. It separates the client-side `Worker` from the platform service that knows how to spawn a
worker, so application code can keep message handling in Effect.

## Client and platform

`Worker.WorkerPlatform` exposes `spawn(id)`, returning a `Worker<O, I>`. A worker has two main
operations:

- `worker.send(message, transfers?)` sends an input message and reports `WorkerError` on failure.
- `worker.run(handler, { onSpawn? })` runs a long-lived Effect handler for output messages and
  remains active until interrupted or the worker fails.

Provide a platform adapter's `layer(...)` when you need both the worker platform and its spawner:
`NodeWorker.layer(spawn)`, `BunWorker.layer(spawn)`, `DenoWorker.layer(spawn)`, or
`BrowserWorker.layer(spawn)`. Use the adapter's `layerPlatform` alone when a spawner is supplied
separately. Deno's worker-side runner is provided by `DenoWorkerRunner.layer` or
`DenoWorkerRunner.layerMessagePort`.

## Worker-side runners

`WorkerRunner.WorkerRunner` handles messages addressed by numeric port id. Its `run(handler)` starts
the receive loop, while `send(portId, message, transfers?)` sends replies. The
`WorkerRunnerPlatform` service starts a platform-specific runner. `WorkerError` distinguishes spawn,
send, receive, and unknown failures; `Transferable` provides schemas and collectors for transferable
values such as `Uint8Array`, `MessagePort`, and `ImageData`.

Keep worker scopes explicit: `run` is long-lived, worker resources belong to the surrounding scope,
and protocol messages should be decoded with schemas at the boundary.
