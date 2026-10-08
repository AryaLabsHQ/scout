# Effect Callback Interop Patterns

## Table of Contents

- [Effect.callback Pattern](#effectcallback-pattern)
- [Instance.bind for AsyncLocalStorage](#instancebind-for-asynclocalstorage)
- [Native Addon Callbacks](#native-addon-callbacks)
- [EventEmitter Integration](#eventemitter-integration)
- [Wrapping External Libraries](#wrapping-external-libraries)
- [Stream.runForEach with forkScoped](#streamrunforeach-with-forkscoped)
- [Common Pitfalls](#common-pitfalls)
- [Code Examples](#code-examples)
- [Summary](#summary)

<!-- End table of contents -->

**Source:** `effect/Effect.ts` (`Effect.callback`, `Effect.async`)

- see

  `~/Developer/effect/packages/effect/src/Effect.ts`

Integrating Effect-TS with callback-based Node.js APIs, based on patterns from opencode.

## Effect.callback Pattern

Use `Effect.callback` to wrap Node.js callback-style APIs into Effect computations.

```typescript
import { Effect } from "effect";

const wrappedApi = Effect.callback<SuccessType, ErrorType>((resume) => {
  // Callback-style API call
  nativeApi.call(params, (error, result) => {
    if (error) {
      resume(Effect.fail(error));
    } else {
      resume(Effect.succeed(result));
    }
  });

  // Optional: return cleanup effect for cancellation
  return Effect.sync(() => {
    nativeApi.cancel();
  });
});
```

**Key points:**

- `resume` is called exactly once to complete the Effect
- Pass `Effect.succeed(value)` for success, `Effect.fail(error)` for failure
- Return an optional cleanup Effect for cancellation support

### Example: Spawning a Process

```typescript
import { Effect, Deferred, Exit } from "effect";
import * as NodeChildProcess from "node:child_process";
import launch from "cross-spawn";

type ExitSignal = Deferred.Deferred<readonly [code: number | null, signal: NodeJS.Signals | null]>;

const spawn = (command: string, args: string[], opts: NodeChildProcess.SpawnOptions) =>
  Effect.callback<readonly [NodeChildProcess.ChildProcess, ExitSignal], PlatformError>((resume) => {
    const signal =
      Deferred.makeUnsafe<readonly [code: number | null, signal: NodeJS.Signals | null]>();
    const proc = launch(command, args, opts);
    let end = false;
    let exit: readonly [code: number | null, signal: NodeJS.Signals | null] | undefined;

    proc.on("error", (err) => {
      resume(Effect.fail(toPlatformError("spawn", err, command)));
    });

    proc.on("exit", (...args) => {
      exit = args;
    });

    proc.on("close", (...args) => {
      if (end) return;
      end = true;
      Deferred.doneUnsafe(signal, Exit.succeed(exit ?? args));
    });

    proc.on("spawn", () => {
      resume(Effect.succeed([proc, signal]));
    });

    // Cleanup on cancellation
    return Effect.sync(() => {
      proc.kill("SIGTERM");
    });
  });
```

## Instance.bind for AsyncLocalStorage

`Instance.bind(fn)` captures the current Instance AsyncLocalStorage context and restores it
synchronously when the callback fires.

### Implementation

```typescript
export const Instance = {
  /**
   * Captures the current instance ALS context and returns a wrapper that
   * restores it when called. Use this for callbacks that fire outside the
   * instance async context (native addons, event emitters, timers, etc.).
   */
  bind<F extends (...args: any[]) => any>(fn: F): F {
    const ctx = context.use();
    return ((...args: any[]) => context.provide(ctx, () => fn(...args))) as F;
  },
};
```

### When to Use

**Use `Instance.bind` for:**

- Native addon callbacks (`@parcel/watcher`, `node-pty`, native `fs.watch`)
- File system watchers
- PTY (pseudo-terminal) callbacks
- Any callback that needs to call `Bus.publish` or access `Instance.directory`

**Do NOT use for:**

- `setTimeout` / `setInterval`
- `Promise.then` / `Promise.catch`
- `EventEmitter.on` (EventEmitter maintains its own context)
- Effect fibers (Effect manages context automatically)

### Usage Pattern

```typescript
// Without Instance.bind - LOSES CONTEXT
nativeAddon.subscribe((data) => {
  // Instance.directory will be undefined here!
  Bus.publish(Event, { file: data.path });
});

// With Instance.bind - PRESERVES CONTEXT
const cb = Instance.bind((data) => {
  // Instance.directory is properly restored
  Bus.publish(Event, { file: data.path });
});
nativeAddon.subscribe(cb);
```

## Native Addon Callbacks

Native addons (compiled C++ modules) execute callbacks from native code, bypassing normal async
context propagation.

### @parcel/watcher Example

```typescript
import { Instance } from "@/project/instance";
import { Bus } from "@/bus";
import type ParcelWatcher from "@parcel/watcher";

const cb: ParcelWatcher.SubscribeCallback = Instance.bind((err, evts) => {
  if (err) return;
  for (const evt of evts) {
    if (evt.type === "create") Bus.publish(Event.Updated, { file: evt.path, event: "add" });
    if (evt.type === "update") Bus.publish(Event.Updated, { file: evt.path, event: "change" });
    if (evt.type === "delete") Bus.publish(Event.Updated, { file: evt.path, event: "unlink" });
  }
});

// Subscribe with context-preserved callback
const subscription = await watcher.subscribe(directory, cb, {
  ignore,
  backend,
});
```

### node-pty Example

```typescript
import { Instance } from "@/project/instance";
import { Bus } from "@/bus";
import { Effect } from "effect";
import { spawn } from "bun-pty";

const proc = spawn(command, args, { name: "xterm-256color", cwd, env });

// Data callback - needs Instance.bind
proc.onData(
  Instance.bind((chunk) => {
    session.cursor += chunk.length;

    // Publish to WebSocket subscribers
    for (const [key, ws] of session.subscribers.entries()) {
      if (ws.readyState !== 1) {
        session.subscribers.delete(key);
        continue;
      }
      try {
        ws.send(chunk);
      } catch {
        session.subscribers.delete(key);
      }
    }

    // Update buffer
    session.buffer += chunk;
    if (session.buffer.length > BUFFER_LIMIT) {
      const excess = session.buffer.length - BUFFER_LIMIT;
      session.buffer = session.buffer.slice(excess);
      session.bufferCursor += excess;
    }
  }),
);

// Exit callback - needs Instance.bind
proc.onExit(
  Instance.bind(({ exitCode }) => {
    if (session.info.status === "exited") return;
    session.info.status = "exited";

    // Bus.publish needs the Instance context
    void Bus.publish(Event.Exited, { id, exitCode });

    // Can also fork Effect operations
    Effect.runFork(remove(id));
  }),
);
```

## EventEmitter Integration

Converting EventEmitter-based APIs to Effect Streams.

### Basic Pattern

```typescript
import { Effect, Stream, Scope, PubSub } from "effect";

function fromEventEmitter<T>(emitter: EventEmitter, eventName: string): Stream.Stream<T> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const pubsub = yield* PubSub.unbounded<T>();

      const listener = (data: T) => {
        void Effect.runFork(PubSub.publish(pubsub, data));
      };

      emitter.on(eventName, listener);

      // Cleanup on stream end
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          emitter.removeListener(eventName, listener);
        }),
      );

      return Stream.fromPubSub(pubsub);
    }),
  );
}
```

### Using Effect.acquireRelease

For one-time setup/cleanup of EventEmitter listeners:

```typescript
import { Effect, Scope } from "effect";

const subscribeToEmitter = Effect.gen(function* () {
  const scope = yield* Scope.make();

  const subscription = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const listener = (data: string) => {
        console.log("Received:", data);
      };
      emitter.on("data", listener);
      return listener;
    }),
    (listener) =>
      Effect.sync(() => {
        emitter.removeListener("data", listener);
      }),
  );

  return subscription;
});
```

## Wrapping External Libraries

Pattern for creating a Service facade around callback-based external libraries.

### Service Structure

```typescript
import { Effect, Layer, Context, Stream } from "effect";

// Define the external library interface
export interface ExternalLibInterface {
  readonly connect: () => Effect.Effect<void>;
  readonly disconnect: () => Effect.Effect<void>;
  readonly publish: (topic: string, message: string) => Effect.Effect<void>;
  readonly subscribe: (topic: string) => Stream.Stream<string>;
}

// Create the service tag
export class ExternalLibService extends Context.Service<ExternalLibService, ExternalLibInterface>()(
  "@myapp/ExternalLib",
) {}

// Implement the layer
export const layer = Layer.effect(
  ExternalLibService,
  Effect.gen(function* () {
    const client = yield* Effect.promise(() => import("external-lib"));

    const connect = Effect.fn("ExternalLib.connect")(function* () {
      yield* Effect.callback<void, Error>((resume) => {
        const conn = client.connect({
          onConnect: () => resume(Effect.void),
          onError: (err) => resume(Effect.fail(err)),
        });
        return Effect.sync(() => conn.disconnect());
      });
    });

    const disconnect = Effect.fn("ExternalLib.disconnect")(function* () {
      yield* Effect.promise(() => client.disconnect());
    });

    const publish = Effect.fn("ExternalLib.publish")(function* (topic: string, message: string) {
      yield* Effect.tryPromise({
        try: () => client.publish(topic, message),
        catch: (err) => new PublishError(String(err)),
      });
    });

    const subscribe = (topic: string): Stream.Stream<string> => {
      return Stream.unwrap(
        Effect.gen(function* () {
          const pubsub = yield* PubSub.unbounded<string>();

          // Use Instance.bind if accessing Instance context
          const handler = Instance.bind((msg: string) => {
            void Effect.runFork(PubSub.publish(pubsub, msg));
          });

          const subscription = client.subscribe(topic, handler);

          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              subscription.unsubscribe();
            }),
          );

          return Stream.fromPubSub(pubsub);
        }),
      );
    };

    return ExternalLibService.of({ connect, disconnect, publish, subscribe });
  }),
);
```

## Stream.runForEach with forkScoped

Pattern for converting event callbacks to managed Stream consumers with automatic cleanup.

### Bus Subscription Pattern

Shape of a bus service that bridges a `PubSub` to callback subscribers:

```typescript
import { Effect, Scope, PubSub, Stream, Exit } from "effect";

function on<T>(pubsub: PubSub.PubSub<T>, type: string, callback: (event: T) => unknown) {
  return Effect.gen(function* () {
    log.info("subscribing", { type });

    // Create a scope for this subscription
    const scope = yield* Scope.make();

    // Subscribe to the pubsub within the scope
    const subscription = yield* Scope.provide(scope)(PubSub.subscribe(pubsub));

    // Run the stream consumer in a scoped fiber
    yield* Scope.provide(scope)(
      Stream.fromSubscription(subscription).pipe(
        Stream.runForEach((msg) =>
          Effect.tryPromise({
            try: () => Promise.resolve().then(() => callback(msg)),
            catch: (cause) => {
              log.error("subscriber failed", { type, cause });
            },
          }).pipe(Effect.ignore),
        ),
        Effect.forkScoped, // <-- Forks a fiber that will be interrupted when scope closes
      ),
    );

    // Return cleanup function
    return () => {
      log.info("unsubscribing", { type });
      Effect.runFork(Scope.close(scope, Exit.void));
    };
  });
}
```

### Key Benefits

1. **Automatic cleanup**: When the scope closes, the fiber is interrupted
2. **Backpressure handling**: `runForEach` processes one message at a time
3. **Error isolation**: Errors in one callback don't affect others

### InstanceState Integration

Use with `InstanceState.make` for per-instance subscriptions:

```typescript
import { InstanceState } from "@/effect/instance-state";
import { Bus } from "@/bus";

export const layer = Layer.effect(
  MyService,
  Effect.gen(function* () {
    const cache = yield* InstanceState.make<State>(
      Effect.fn("MyService.state")(function* (ctx) {
        const bus = yield* Bus.Service;

        // Subscribe to events - automatically cleaned up on instance disposal
        const unsubscribe = yield* bus.subscribeCallback(MyEvent, (event) => {
          // Handle event
        });

        // Or manually fork a scoped stream consumer
        const stream = bus.subscribe(MyEvent);
        yield* stream.pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              // Process event
            }),
          ),
          Effect.forkScoped,
        );

        return {
          /* state */
        };
      }),
    );

    return MyService.of({
      /* methods */
    });
  }),
);
```

## Common Pitfalls

### 1. Forgetting Instance.bind

**Problem:** Native callbacks lose the Instance context.

```typescript
// BAD: Loses context
watcher.subscribe(dir, (err, events) => {
  // Instance.directory is undefined!
  Bus.publish(Event, { dir: Instance.directory }); // ❌ Fails
});

// GOOD: Preserves context
const cb = Instance.bind((err, events) => {
  // Instance.directory is restored
  Bus.publish(Event, { dir: Instance.directory }); // ✅ Works
});
watcher.subscribe(dir, cb);
```

### 2. Memory Leaks from Uncleaned Listeners

**Problem:** Event listeners accumulate without cleanup.

```typescript
// BAD: Leaks listeners
function setupWatcher() {
  const emitter = new EventEmitter();
  emitter.on("data", handler); // Never removed!
  return emitter;
}

// GOOD: Proper cleanup
function setupWatcher() {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const emitter = new EventEmitter();
      emitter.on("data", handler);
      return emitter;
    }),
    (emitter) =>
      Effect.sync(() => {
        emitter.removeListener("data", handler);
      }),
  );
}
```

### 3. Trying to yield\* Inside Non-Effect Callbacks

**Problem:** Cannot use Effect operations inside raw callbacks.

```typescript
// BAD: yield* in callback
emitter.on("data", (data) => {
  const result = yield * someEffect(data); // ❌ Syntax error!
});

// GOOD: Fork or run
emitter.on("data", (data) => {
  // Option 1: Fire-and-forget
  Effect.runFork(someEffect(data));

  // Option 2: Run and await (careful with async)
  Effect.runPromise(someEffect(data)).then((result) => {
    // Use result
  });
});

// GOOD: Convert to Stream
const stream = fromEventEmitter(emitter, "data");
yield *
  stream.pipe(
    Stream.runForEach((data) => someEffect(data)),
    Effect.forkScoped,
  );
```

### 4. Calling resume Multiple Times

**Problem:** `Effect.callback` resume can only be called once.

```typescript
// BAD: Multiple resume calls
Effect.callback((resume) => {
  api.on("event1", () => resume(Effect.succeed(1)));
  api.on("event2", () => resume(Effect.succeed(2))); // ❌ Second call is ignored!
});

// GOOD: Use Deferred for multiple events
Effect.gen(function* () {
  const deferred = yield* Deferred.make<string>();

  const handler = (value: string) => {
    Effect.runFork(Deferred.succeed(deferred, value));
  };

  api.on("event", handler);

  const result = yield* Deferred.await(deferred);

  api.removeListener("event", handler);
  return result;
});
```

## Code Examples

### Complete PTY Service Pattern

```typescript
import { Effect, Layer, Context } from "effect";
import { Instance } from "@/project/instance";
import { InstanceState } from "@/effect/instance-state";
import { Bus } from "@/bus";
import { spawn } from "bun-pty";

// pty.ts
export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info>;
  readonly write: (id: PtyID, data: string) => Effect.Effect<void>;
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Pty") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service;

    const cache = yield* InstanceState.make<Map<PtyID, ActiveSession>>(
      Effect.fn("Pty.state")(function* (ctx) {
        const sessions = new Map<PtyID, ActiveSession>();

        // Cleanup all sessions on instance disposal
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            for (const session of sessions.values()) {
              session.process.kill();
            }
            sessions.clear();
          }),
        );

        return sessions;
      }),
    );

    const create = Effect.fn("Pty.create")(function* (input: CreateInput) {
      const sessions = yield* InstanceState.get(cache);

      return yield* Effect.promise(async () => {
        const id = generateId();
        const proc = spawn(input.command, input.args, {
          cwd: input.cwd || Instance.directory,
          env: process.env,
        });

        const session: ActiveSession = {
          id,
          process: proc,
          buffer: "",
        };
        sessions.set(id, session);

        // CRITICAL: Use Instance.bind for native callbacks
        proc.onData(
          Instance.bind((chunk) => {
            session.buffer += chunk;

            // Now we can safely use Bus.publish
            void bus.publish(PtyEvent.Data, { id, chunk });
          }),
        );

        proc.onExit(
          Instance.bind(({ exitCode }) => {
            session.process = undefined as any;
            void bus.publish(PtyEvent.Exited, { id, exitCode });
          }),
        );

        return session;
      });
    });

    const write = Effect.fn("Pty.write")(function* (id: PtyID, data: string) {
      const sessions = yield* InstanceState.get(cache);
      const session = sessions.get(id);
      if (session?.process) {
        session.process.write(data);
      }
    });

    return Service.of({ create, write });
  }),
);

export * as Pty from "./pty";
```

### File Watcher with Instance.bind

```typescript
import { Effect, Layer, Context } from "effect";
import { Instance } from "@/project/instance";
import { InstanceState } from "@/effect/instance-state";
import { Bus } from "@/bus";
import type ParcelWatcher from "@parcel/watcher";

// file-watcher.ts
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service;

    yield* InstanceState.make(
      Effect.fn("FileWatcher.state")(function* () {
        const w = watcher(); // Native addon
        if (!w) return;

        const subs: ParcelWatcher.AsyncSubscription[] = [];

        // Cleanup subscriptions on instance disposal
        yield* Effect.addFinalizer(() =>
          Effect.promise(() => Promise.allSettled(subs.map((sub) => sub.unsubscribe()))),
        );

        // CRITICAL: Wrap callback with Instance.bind
        const cb: ParcelWatcher.SubscribeCallback = Instance.bind((err, evts) => {
          if (err) return;
          for (const evt of evts) {
            // Instance context is preserved - can use Bus.publish
            if (evt.type === "create") {
              void bus.publish(Event.Updated, {
                file: evt.path,
                event: "add",
              });
            }
            if (evt.type === "update") {
              void bus.publish(Event.Updated, {
                file: evt.path,
                event: "change",
              });
            }
            if (evt.type === "delete") {
              void bus.publish(Event.Updated, {
                file: evt.path,
                event: "unlink",
              });
            }
          }
        });

        // Subscribe with context-preserved callback
        const sub = yield* Effect.promise(() =>
          w.subscribe(Instance.directory, cb, { backend: "fs-events" }),
        );
        subs.push(sub);
      }),
    );

    return Service.of({
      init: Effect.fn("FileWatcher.init")(function* () {
        yield* InstanceState.get(state);
      }),
    });
  }),
);

export * as FileWatcher from "./file-watcher";
```

### Bus Service with forkScoped Subscriptions

```typescript
import { Effect, PubSub, Scope, Stream, Exit, Layer, Context } from "effect";
import { InstanceState } from "@/effect/instance-state";

// bus.ts
export interface Interface {
  readonly publish: <D extends BusEvent.Definition>(
    def: D,
    properties: z.output<D["properties"]>,
  ) => Effect.Effect<void>;
  readonly subscribe: <D extends BusEvent.Definition>(def: D) => Stream.Stream<Payload<D>>;
  readonly subscribeCallback: <D extends BusEvent.Definition>(
    def: D,
    callback: (event: Payload<D>) => unknown,
  ) => Effect.Effect<() => void>;
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Bus") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cache = yield* InstanceState.make<State>(
      Effect.fn("Bus.state")(function* (ctx) {
        const wildcard = yield* PubSub.unbounded<Payload>();
        const typed = new Map<string, PubSub.PubSub<Payload>>();

        // Shutdown pubsubs on instance disposal
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            yield* PubSub.publish(wildcard, {
              type: InstanceDisposed.type,
              properties: { directory: ctx.directory },
            });
            yield* PubSub.shutdown(wildcard);
            for (const ps of typed.values()) {
              yield* PubSub.shutdown(ps);
            }
          }),
        );

        return { wildcard, typed };
      }),
    );

    // Subscribe with automatic cleanup via forkScoped
    function on<T>(pubsub: PubSub.PubSub<T>, type: string, callback: (event: T) => unknown) {
      return Effect.gen(function* () {
        const scope = yield* Scope.make();
        const subscription = yield* Scope.provide(scope)(PubSub.subscribe(pubsub));

        // Fork scoped fiber - automatically interrupted when scope closes
        yield* Scope.provide(scope)(
          Stream.fromSubscription(subscription).pipe(
            Stream.runForEach((msg) =>
              Effect.tryPromise({
                try: () => Promise.resolve().then(() => callback(msg)),
                catch: (cause) => log.error("subscriber failed", { type, cause }),
              }).pipe(Effect.ignore),
            ),
            Effect.forkScoped,
          ),
        );

        // Return cleanup function that closes the scope
        return () => {
          Effect.runFork(Scope.close(scope, Exit.void));
        };
      });
    }

    const subscribeCallback = Effect.fn("Bus.subscribeCallback")(function* <
      D extends BusEvent.Definition,
    >(def: D, callback: (event: Payload<D>) => unknown) {
      const state = yield* InstanceState.get(cache);

      let ps = state.typed.get(def.type);
      if (!ps) {
        ps = yield* PubSub.unbounded<Payload>();
        state.typed.set(def.type, ps);
      }

      // Subscribe with automatic cleanup
      return yield* on(ps, def.type, callback);
    });

    return Service.of({ subscribeCallback /* other methods */ });
  }),
);

export * as Bus from "./bus";
```

## Summary

| Pattern                            | When to Use                                       |
| ---------------------------------- | ------------------------------------------------- |
| `Effect.callback`                  | Wrapping callback-style APIs into Effects         |
| `Instance.bind`                    | Native addon callbacks that need Instance context |
| `Stream.fromPubSub` + `forkScoped` | Converting events to managed streams              |
| `Effect.acquireRelease`            | One-time setup/cleanup of resources               |
| `Effect.addFinalizer`              | Adding cleanup to current scope                   |

Remember: Native addons bypass normal async context propagation. Always use `Instance.bind` when
callbacks need to access `Instance.directory`, call `Bus.publish`, or use other context-dependent
operations.
