# Dual API Design in Effect-TS v4

**Source:** `effect/ManagedRuntime.ts` - see `~/Developer/effect/packages/effect/src/ManagedRuntime.ts`
**Source:** `effect/Layer.ts` - see `~/Developer/effect/packages/effect/src/Layer.ts`

Exposing both Effect and imperative/async APIs using the `makeRuntime` pattern from opencode.

---

## Why Dual API?

Effect services benefit from a dual API design that serves both Effect consumers and traditional async/await code:

| Consumer          | Preferred API                            |
| ----------------- | ---------------------------------------- |
| Effect code       | `yield* Service.method()`                |
| Non-Effect code   | `await Service.method()`                 |
| Gradual migration | Start with imperative, migrate to Effect |

### The Problem

Effect's service pattern requires being inside a `Effect.gen` context:

```ts
// Effect-only code - requires Effect context
const result = yield * MyService.method(input);
```

This creates friction when:

- Calling from existing async functions
- Migrating legacy codebases incrementally
- Writing tests in traditional async/await style
- Providing a simpler API surface for consumers

### The Solution

Export both Effect service methods AND imperative wrapper functions:

```ts
// Effect API - for consumers already in Effect context
yield * MyService.Service.method(input);

// Imperative API - for async/await consumers
await MyService.method(input);
```

---

## The makeRuntime Pattern

The `makeRuntime` helper creates a lazily-initialized `ManagedRuntime` that shares dependencies across all services.

### Source: packages/opencode/src/effect/run-service.ts

```ts
import { Effect, Layer, ManagedRuntime } from "effect";
import * as Context from "effect/Context";

// Global memoMap ensures layer deduplication across all services
export const memoMap = Layer.makeMemoMapUnsafe();

export function makeRuntime<I, S, E>(
  service: Context.Service<I, S>,
  layer: Layer.Layer<I, E>,
) {
  // Lazy initialization - runtime created only on first use
  let rt: ManagedRuntime.ManagedRuntime<I, E> | undefined;
  const getRuntime = () => (rt ??= ManagedRuntime.make(layer, { memoMap }));

  return {
    // Synchronous execution (for sync-only effects)
    runSync: <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>) =>
      getRuntime().runSync(service.use(fn)),

    // Promise-returning (most common for imperative API)
    runPromise: <A, Err>(
      fn: (svc: S) => Effect.Effect<A, Err, I>,
      options?: Effect.RunOptions,
    ) => getRuntime().runPromise(service.use(fn), options),

    // Promise with Exit (for error handling)
    runPromiseExit: <A, Err>(
      fn: (svc: S) => Effect.Effect<A, Err, I>,
      options?: Effect.RunOptions,
    ) => getRuntime().runPromiseExit(service.use(fn), options),

    // Fork a fiber
    runFork: <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>) =>
      getRuntime().runFork(service.use(fn)),

    // Callback-style execution
    runCallback: <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>) =>
      getRuntime().runCallback(service.use(fn)),
  };
}
```

### Key Components

1. **Shared `memoMap`**: Global deduplication prevents duplicate layer construction
2. **Lazy initialization**: Runtime created only when first accessed (`??=` pattern)
3. **Singleton pattern**: Each service gets one runtime instance
4. **`service.use(fn)`**: Provides service instance to the effect function

---

## Service Namespace Structure

A complete service following the dual API pattern:

```ts
export namespace MyService {
  // 1. Interface - pure TypeScript contract
  export interface Interface {
    readonly method: (input: Input) => Effect.Effect<Output, MyError, never>;
  }

  // 2. Service Tag - Effect's dependency injection key
  export class Service extends Context.Service<Service, Interface>()(
    "@my/Service",
  ) {}

  // 3. Layer - service implementation
  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      // Dependencies
      const dep = yield* OtherService.Service;

      // Implementation
      const method = Effect.fn("MyService.method")(function* (input: Input) {
        // ... effect implementation
        return output;
      });

      return Service.of({ method });
    }),
  );

  // 4. Default Layer - wired with dependencies
  export const defaultLayer = layer.pipe(
    Layer.provide(OtherService.defaultLayer),
  );

  // 5. Runtime (not exported) - for internal use only
  const { runPromise, runSync } = makeRuntime(Service, defaultLayer);

  // 6. Public Imperative API - async/await wrappers
  export const method = (input: Input) =>
    runPromise((svc) => svc.method(input));
}
```

---

## Default Layer Wiring

### Chaining Dependencies

Layers compose with `Layer.provide` in reverse order (innermost first):

```ts
export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer), // provides DB to MyService
  Layer.provide(Config.defaultLayer), // provides Config to Database
  Layer.provide(Logger.defaultLayer), // provides Logger to everything
);
```

### Lazy Default Layer with Layer.unwrap

For circular dependency avoidance or expensive construction:

```ts
// packages/opencode/src/tool/registry.ts
export const defaultLayer = Layer.unwrap(
  Effect.sync(() =>
    layer.pipe(
      Layer.provide(Config.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
    ),
  ),
);
```

`Layer.unwrap` defers layer construction until first use, breaking circular dependency chains.

### Avoiding Circular Dependencies

```ts
// Good - Config has no service dependencies
export const defaultLayer = Config.layer;

// Good - Session depends on Config and Bus
export const defaultLayer = layer.pipe(
  Layer.provide(Bus.defaultLayer),
  Layer.provide(Config.defaultLayer),
);

// Good - Bus has no service dependencies (uses InstanceState)
export const defaultLayer = Bus.layer;
```

---

## Facade Function Patterns

### Plain Async Functions

The simplest pattern - no special wrappers:

```ts
const { runPromise } = makeRuntime(Service, defaultLayer);

export async function get(id: string) {
  return runPromise((svc) => svc.get(id));
}
```

### With Zod Validation (from packages/opencode/src/util/fn.ts)

For runtime input validation:

```ts
import { z } from "zod";

export function fn<T extends z.ZodType, Result>(
  schema: T,
  cb: (input: z.infer<T>) => Result,
) {
  const result = (input: z.infer<T>) => {
    const parsed = schema.parse(input); // throws on invalid
    return cb(parsed);
  };
  result.force = (input: z.infer<T>) => cb(input);
  result.schema = schema;
  return result;
}

// Usage
export const get = fn(z.object({ id: z.string() }), (input) =>
  runPromise((svc) => svc.get(input.id)),
);

// Now supports both:
await get({ id: "123" }); // validated
await get.force({ id: "123" }); // skip validation (for internal use)
```

### Type Inference

Return types inferred from service Interface:

```ts
export interface Interface {
  readonly get: (id: string) => Effect.Effect<User, NotFoundError>;
}

// Type: (id: string) => Promise<User>
// Note: Errors propagate as rejected promises
export const get = (id: string) => runPromise((svc) => svc.get(id));
```

### Error Handling

Effect errors propagate as rejected promises:

```ts
// Effect service defines typed error
readonly get: (id: string) => Effect.Effect<User, NotFoundError>

// Imperative API throws on error
try {
  const user = await MyService.get("unknown-id")
} catch (error) {
  // error is NotFoundError (or whatever Effect failed with)
}
```

### When to Skip Imperative API

Skip the imperative API when:

- Service is only consumed by other Effect code
- No legacy code needs to call it
- The service is purely internal (e.g., database implementation detail)

```ts
// Internal service - Effect-only
export namespace InternalDB {
  export interface Interface { ... }
  export class Service extends Context.Service<...>()(...) {}
  export const layer = Layer.effect(...)
  // No makeRuntime, no imperative exports
  // Only exported: Service tag for dependency injection
}
```

---

## Examples from Opencode

### Bus Service - Cleanest Example

**File: packages/opencode/src/bus/index.ts**

```ts
export namespace Bus {
  export interface Interface {
    readonly publish: <D extends BusEvent.Definition>(
      def: D,
      properties: z.output<D["properties"]>,
    ) => Effect.Effect<void>
    readonly subscribe: <D extends BusEvent.Definition>(def: D) =>
      Stream.Stream<Payload<D>>
    readonly subscribeAll: () => Stream.Stream<Payload>
    readonly subscribeCallback: <D extends BusEvent.Definition>(
      def: D,
      callback: (event: Payload<D>) => unknown,
    ) => Effect.Effect<() => void>
    readonly subscribeAllCallback: (callback: (event: any) => unknown) =>
      Effect.Effect<() => void>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/Bus") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const cache = yield* InstanceState.make<State>(...)

      function publish(...) { ... }
      function subscribe(...) { ... }
      // ... implementations

      return Service.of({ publish, subscribe, subscribeAll, subscribeCallback, subscribeAllCallback })
    }),
  )

  // Bus has no service dependencies - uses InstanceState instead
  // So defaultLayer = layer (no Layer.provide needed)
  const { runPromise, runSync } = makeRuntime(Service, layer)

  // Imperative API
  export async function publish<D extends BusEvent.Definition>(
    def: D,
    properties: z.output<D["properties"]>
  ) {
    return runPromise((svc) => svc.publish(def, properties))
  }

  export function subscribe<D extends BusEvent.Definition>(
    def: D,
    callback: (event: { type: D["type"]; properties: z.infer<D["properties"]> }) => unknown,
  ) {
    // Uses runSync because subscribe chain is entirely synchronous
    return runSync((svc) => svc.subscribeCallback(def, callback))
  }

  export function subscribeAll(callback: (event: any) => unknown) {
    return runSync((svc) => svc.subscribeAllCallback(callback))
  }
}
```

**Key insight**: Bus uses `runSync` for subscriptions because `InstanceState.get`, `PubSub.subscribe`, and `Scope.make` are all synchronous operations.

### Session Service - Complex Example

**File: packages/opencode/src/session/index.ts**

```ts
export namespace Session {
  export interface Interface {
    readonly create: (input?: { ... }) => Effect.Effect<Info>
    readonly fork: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Info>
    readonly get: (id: SessionID) => Effect.Effect<Info>
    readonly setTitle: (input: { sessionID: SessionID; title: string }) => Effect.Effect<void>
    // ... 20+ methods
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/Session") {}

  export const layer: Layer.Layer<Service, never, Bus.Service | Config.Service> =
    Layer.effect(Service, Effect.gen(function* () {
      const bus = yield* Bus.Service
      const config = yield* Config.Service
      // ... implementation with many methods
      return Service.of({ create, fork, get, setTitle, ... })
    }))

  // Wired with dependencies
  export const defaultLayer = layer.pipe(
    Layer.provide(Bus.layer),           // provides Bus
    Layer.provide(Config.defaultLayer)  // provides Config
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  // Imperative API - many methods, some with Zod validation via fn()
  export const create = fn(
    z.object({ parentID: ..., title: ... }).optional(),
    (input) => runPromise((svc) => svc.create(input))
  )

  export const get = fn(SessionID.zod, (id) =>
    runPromise((svc) => svc.get(id))
  )

  export const fork = fn(
    z.object({ sessionID: SessionID.zod, messageID: MessageID.zod.optional() }),
    (input) => runPromise((svc) => svc.fork(input))
  )

  // Generator function for streaming results
  export function* list(input?: { ... }) {
    // Uses Database.use directly (sync operation in Session)
    const rows = Database.use((db) => ...)
    for (const row of rows) {
      yield fromRow(row)
    }
  }
}
```

### Command Service - Moderate Complexity

**File: packages/opencode/src/command/index.ts**

```ts
export namespace Command {
  export interface Interface {
    readonly get: (name: string) => Effect.Effect<Info | undefined>;
    readonly list: () => Effect.Effect<Info[]>;
  }

  export class Service extends Context.Service<Service, Interface>()(
    "@opencode/Command",
  ) {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service;
      const mcp = yield* MCP.Service;
      const skill = yield* Skill.Service;

      const init = Effect.fn("Command.state")(function* (ctx) {
        const commands: Record<string, Info> = {};
        // Build command registry from Config, MCP, and Skill
        return { commands };
      });

      const cache = yield* InstanceState.make<State>((ctx) => init(ctx));

      const get = Effect.fn("Command.get")(function* (name: string) {
        const state = yield* InstanceState.get(cache);
        return state.commands[name];
      });

      const list = Effect.fn("Command.list")(function* () {
        const state = yield* InstanceState.get(cache);
        return Object.values(state.commands);
      });

      return Service.of({ get, list });
    }),
  );

  // Multiple dependency chain
  export const defaultLayer = layer.pipe(
    Layer.provide(Config.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provide(Skill.defaultLayer),
  );

  const { runPromise } = makeRuntime(Service, defaultLayer);

  // Simple imperative wrappers
  export async function get(name: string) {
    return runPromise((svc) => svc.get(name));
  }

  export async function list() {
    return runPromise((svc) => svc.list());
  }
}
```

---

## Performance Considerations

### Shared MemoMap

```ts
// Global - shared across ALL services
export const memoMap = Layer.makeMemoMapUnsafe();
```

Without sharing:

```
Service A needs Config → creates Config layer
Service B needs Config → creates Config layer (duplicate!)
```

With shared memoMap:

```
Service A needs Config → creates Config layer (cached)
Service B needs Config → reuses cached Config layer
```

### Lazy Initialization

```ts
export function makeRuntime(...) {
  let rt: ManagedRuntime.ManagedRuntime<I, E> | undefined
  const getRuntime = () => (rt ??= ManagedRuntime.make(layer, { memoMap }))
  // ...
}
```

Runtime is only created when:

- First imperative function is called, OR
- First `runPromise`/`runSync`/`runFork` is invoked

### No Overhead for Unused Services

```ts
// If never called, no runtime is created
export namespace HeavyService {
  const { runPromise } = makeRuntime(Service, expensiveLayer);

  export async function doWork() {
    return runPromise((svc) => svc.doWork());
  }
}

// No runtime exists until:
await HeavyService.doWork(); // ← runtime created here
```

### Test Performance

The shared memoMap is especially beneficial in tests where multiple services are exercised:

```ts
// Test: packages/opencode/test/effect/run-service.test.ts
test("makeRuntime shares dependent layers through the shared memo map", async () => {
  // Two services, both need Config
  const { runPromise: runOne } = makeRuntime(One, one);
  const { runPromise: runTwo } = makeRuntime(Two, two);

  // Config layer is created once, shared by both
  await runOne((svc) => svc.work());
  await runTwo((svc) => svc.work());
});
```

---

## Complete Working Example

```ts
import { Effect, Layer, Context } from "effect";
import { z } from "zod";
import { makeRuntime } from "./effect/run-service";

// Domain types
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

type User = z.infer<typeof UserSchema>;

class NotFoundError extends Error {
  constructor(id: string) {
    super(`User not found: ${id}`);
  }
}

// Service namespace
export namespace UserService {
  // 1. Interface
  export interface Interface {
    readonly get: (id: string) => Effect.Effect<User, NotFoundError>;
    readonly create: (input: Omit<User, "id">) => Effect.Effect<User>;
    readonly list: () => Effect.Effect<User[]>;
  }

  // 2. Service tag
  export class Service extends Context.Service<Service, Interface>()(
    "@app/UserService",
  ) {}

  // 3. Layer with implementation
  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      // In real app, inject database here
      const users = new Map<string, User>();
      let nextId = 1;

      const get = Effect.fn("UserService.get")(function* (id: string) {
        const user = users.get(id);
        if (!user) return yield* new NotFoundError(id);
        return user;
      });

      const create = Effect.fn("UserService.create")(function* (
        input: Omit<User, "id">,
      ) {
        const user: User = { ...input, id: String(nextId++) };
        users.set(user.id, user);
        return user;
      });

      const list = Effect.fn("UserService.list")(function* () {
        return Array.from(users.values());
      });

      return Service.of({ get, create, list });
    }),
  );

  // 4. Default layer (no dependencies in this example)
  export const defaultLayer = layer;

  // 5. Runtime (private)
  const { runPromise } = makeRuntime(Service, defaultLayer);

  // 6. Imperative API
  export async function get(id: string): Promise<User> {
    return runPromise((svc) => svc.get(id));
  }

  export async function create(input: Omit<User, "id">): Promise<User> {
    return runPromise((svc) => svc.create(input));
  }

  export async function list(): Promise<User[]> {
    return runPromise((svc) => svc.list());
  }
}

// Usage

// Effect code
const effectProgram = Effect.gen(function* () {
  const user = yield* UserService.Service.create({
    name: "Alice",
    email: "alice@example.com",
  });
  const found = yield* UserService.Service.get(user.id);
  console.log("Effect:", found);
  return found;
});

// Imperative code
async function imperativeCode() {
  const user = await UserService.create({
    name: "Bob",
    email: "bob@example.com",
  });
  const found = await UserService.get(user.id);
  const all = await UserService.list();
  console.log("Imperative:", found, all);
}
```

---

## Summary

| Aspect            | Pattern                                                   |
| ----------------- | --------------------------------------------------------- |
| Runtime creation  | `makeRuntime(Service, defaultLayer)`                      |
| Shared state      | Global `memoMap = Layer.makeMemoMapUnsafe()`              |
| Lazy init         | `let rt; const get = () => (rt ??= ...)`                  |
| Effect API        | `yield* Service.method()` via `Service` tag               |
| Imperative API    | Plain `async function` calling `runPromise((svc) => ...)` |
| Dependency wiring | `layer.pipe(Layer.provide(Dep.layer))`                    |
| Circular deps     | Use `Layer.unwrap` for lazy construction                  |
| Performance       | Shared layers + lazy init = minimal overhead              |

---

## References

- **makeRuntime**: `packages/opencode/src/effect/run-service.ts`
- **Bus** (cleanest example): `packages/opencode/src/bus/index.ts`
- **Session** (complex): `packages/opencode/src/session/index.ts`
- **Command** (moderate): `packages/opencode/src/command/index.ts`
- **fn helper** (validation): `packages/opencode/src/util/fn.ts`
- **Effect docs**: https://effect.website/
