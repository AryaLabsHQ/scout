# Runtime

Use `Effect.run*` for top-level execution. The `Runtime<R>` type is removed in v4.

## Top-Level Execution

```ts
import { Effect } from "effect"

Effect.runSync(Effect.succeed("sync"))
await Effect.runPromise(Effect.succeed("async"))
Effect.runSyncExit(Effect.succeed("exit"))
```

`await` at top level requires ESM with top-level await enabled; in CommonJS, wrap this in `async function main() { ... }` and call `main()`.

## v4: Runtime<R> Removed

In v4, `Runtime<R>` no longer exists. Run functions live directly on `Effect`.

**v3**
```ts
import { Effect, Runtime } from "effect"

const rt = Runtime.defaultRuntime
Runtime.runSync(rt)(Effect.succeed("ok"))
```

**v4**
```ts
import { Effect } from "effect"

Effect.runSync(Effect.succeed("ok"))
```

## Runtime Module Contents (v4)

The `Runtime` module now only contains:
- `Teardown` — interface for handling process exit
- `defaultTeardown` — default teardown implementation
- `makeRunMain` — creates platform-specific main runners

## Fiber Keep-Alive (v4)

In v4, fiber keep-alive is automatic. The core runtime manages a reference-counted keep-alive timer. `runMain` from platform packages is still recommended for signal handling and exit code management.

## runForkWith (v4)

`Effect.runForkWith` exists in v4 for running effects with custom services/dependencies:

```ts
import { Effect, Context } from "effect"

interface Logger {
  log: (message: string) => void
}

const Logger = Context.Service<Logger>("Logger")

const services = Context.make(Logger, {
  log: (message) => console.log(message)
})

const program = Effect.gen(function*() {
  const logger = yield* Logger
  logger.log("Hello from service!")
  return "done"
})

// Returns a Fiber
const fiber = Effect.runForkWith(services)(program)
```

Signature: `<R>(services: Context.Context<R>) => <A, E>(effect: Effect<A, E, R>, options?: RunOptions) => Fiber<A, E>`

## ManagedRuntime for Long-Running Applications

For applications that need to maintain a live effect runtime with services (like servers or CLIs), use `ManagedRuntime`:

```ts
import { ManagedRuntime, Layer } from "effect"

// Create a runtime from a layer
const runtime = ManagedRuntime.make(AppLayer)

// Execute effects within the runtime
const result = await runtime.runPromise(effect)

// Cleanup when done
await runtime.dispose()
```

**Source:** `effect/ManagedRuntime.ts` - see `~/Developer/effect/packages/effect/src/ManagedRuntime.ts`

## Shared Layer Memoization (memoMap)

For sharing service instances across multiple runtimes (singleton pattern), use `Layer.makeMemoMapUnsafe()`:

```ts
import { Layer, ManagedRuntime } from "effect"

// Create a shared memo map
const memoMap = Layer.makeMemoMapUnsafe()

// Both runtimes share the same service instances
const runtime1 = ManagedRuntime.make(Layer1, { memoMap })
const runtime2 = ManagedRuntime.make(Layer2, { memoMap }) // Shares common dependencies

// Services constructed once, shared across both
```

**Real-world pattern** from Expect and OpenCode: Used to ensure expensive services (database connections, HTTP clients) are singletons even when multiple runtimes exist.

**Source:** `effect/internal/layer.ts` - see `~/Developer/effect/packages/effect/src/internal/layer.ts`

---

**Source:** `effect/Effect.ts` - see `~/Developer/effect/packages/effect/src/Effect.ts` (for `runSync`, `runPromise`, `runForkWith`)
