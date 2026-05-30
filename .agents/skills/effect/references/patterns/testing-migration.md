# Testing Migration Guide for Effect v4

**Source:** `@effect/vitest` - see `~/Developer/effect/packages/vitest/src/`
**Source:** `effect/testing/*` (`TestClock.ts`, `TestConsole.ts`, `TestSchema.ts`, `FastCheck.ts`) - see `~/Developer/effect/packages/effect/src/testing/`

A comprehensive guide for migrating tests to Effect v4 using @effect/vitest patterns from opencode.

## Table of Contents

1. [Test Framework Setup](#test-framework-setup)
2. [Test Syntax Migration](#test-syntax-migration)
3. [Providing Dependencies](#providing-dependencies)
4. [Mocking with Layer Overrides](#mocking-with-layer-overrides)
5. [Assertions](#assertions)
6. [Test Utilities](#test-utilities)
7. [Migration from Jest/Vitest Standard](#migration-from-jestvitest-standard)
8. [Examples from Opencode](#examples-from-opencode)

---

## Test Framework Setup

### Installing @effect/vitest

```bash
# Install with your package manager
npm install @effect/vitest
# or
bun add @effect/vitest
```

### Vitest Config for Effect Tests

Opencode uses a custom test helper pattern rather than direct @effect/vitest integration. This provides more control over layer management and test execution.

**File: `test/lib/effect.ts`**

```typescript
import { test, type TestOptions } from "bun:test";
import { Cause, Effect, Exit, Layer } from "effect";
import type * as Scope from "effect/Scope";
import * as TestConsole from "effect/testing/TestConsole";

type Body<A, E, R> = Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>);
const env = TestConsole.layer;

const body = <A, E, R>(value: Body<A, E, R>) =>
  Effect.suspend(() => (typeof value === "function" ? value() : value));

const run = <A, E, R, E2>(
  value: Body<A, E, R | Scope.Scope>,
  layer: Layer.Layer<R, E2, never>,
) =>
  Effect.gen(function* () {
    const exit = yield* body(value).pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.exit,
    );
    if (Exit.isFailure(exit)) {
      for (const err of Cause.prettyErrors(exit.cause)) {
        yield* Effect.logError(err);
      }
    }
    return yield* exit;
  }).pipe(Effect.runPromise);

const make = <R, E>(layer: Layer.Layer<R, E, never>) => {
  const effect = <A, E2>(
    name: string,
    value: Body<A, E2, R | Scope.Scope>,
    opts?: number | TestOptions,
  ) => test(name, () => run(value, layer), opts);

  effect.only = <A, E2>(
    name: string,
    value: Body<A, E2, R | Scope.Scope>,
    opts?: number | TestOptions,
  ) => test.only(name, () => run(value, layer), opts);

  effect.skip = <A, E2>(
    name: string,
    value: Body<A, E2, R | Scope.Scope>,
    opts?: number | TestOptions,
  ) => test.skip(name, () => run(value, layer), opts);

  return { effect };
};

export const it = make(env);

export const testEffect = <R, E>(layer: Layer.Layer<R, E, never>) =>
  make(Layer.provideMerge(layer, env));
```

### Importing `effect` Helper from @effect/vitest

```typescript
// Using opencode's custom pattern
import { testEffect } from "../lib/effect";

// Create test helper with your layer stack
const it = testEffect(yourLayerStack);

// Use in tests
it.effect("test name", () =>
  Effect.gen(function* () {
    // test logic
  }),
);
```

---

## v4 Test Primitives (Quick Reference)

These are the v4 testing primitives this guide builds on. If you already know them, skim and move on.

### `it.effect` vs `it.live`

`@effect/vitest` exports both via `import { it } from "@effect/vitest"`:

| Helper | Base services | Use when |
|--------|---------------|----------|
| `it.effect` | `TestClock` + `TestConsole` | Deterministic time control via `TestClock.adjust(...)`. Most pure-logic tests. |
| `it.live` | Real `Clock` + `TestConsole` | Real time, real filesystem mtimes, real subprocesses, real file locks. |
| `it.scoped` / `it.scopedLive` | Same as above plus a fresh `Scope` | When the test body uses `Effect.acquireRelease` directly. |

**Source:** `~/Developer/effect/packages/vitest/src/index.ts:169-175`. Custom helpers like opencode's `testEffect(layer)` typically wrap both, returning `{ effect, live }` so each test picks its base.

### `Layer.mock(Tag)(partialImpl)` — partial stubs

`Layer.mock` (Layer.ts:1895) is curried. Methods you don't implement throw an `UnimplementedError` defect when called.

```ts
import { Layer, Effect, Option } from "effect"

const stubAccount = Layer.mock(Account.Service)({
  active: () => Effect.succeed(Option.none()),
  // updateActive, list, etc. not implemented — calling them throws UnimplementedError
})

const stubNpm = Layer.mock(Npm.Service)({
  install: () => Effect.void,
  add: () => Effect.die("not allowed in tests"),
  which: () => Effect.succeed(Option.none()),
})
```

Use `Layer.mock` over `Layer.succeed(Tag, Tag.of({ ... }))` whenever you only need a few methods — you don't have to write `Effect.die` placeholders for every unused field. Calling an unimplemented method is loud (defect with stack trace) so tests fail fast if a code path you didn't expect to hit reaches a stubbed dependency.

The two-arg uncurried form also works: `Layer.mock(Tag, partial)`.

### `Layer.fresh(layer)` — bypass shared `MemoMap`

**Why this exists in v4:** Effect v4 auto-memoizes layers across separate `Effect.provide` calls (v3 did not). See `~/Developer/effect/migration/layer-memoization.md`. This makes production composition more efficient but creates a new pitfall in tests:

```ts
const it = testEffect(Storage.defaultLayer)  // builds Storage once, memoizes

it.effect("uses custom storage", () =>
  Effect.gen(function* () {
    const s = yield* Storage.Service  // ← still the outer Storage, not customStorage!
    // ...
  }).pipe(
    Effect.provide(customStorage),  // silently no-op — the memoized one wins
  ),
)
```

`Layer.fresh` (Layer.ts:1762) wraps a layer so it always builds with a fresh `MemoMap`, bypassing the shared cache:

```ts
const remappedStorage = Layer.fresh(
  Storage.layer.pipe(
    Layer.provide(remappedFs(root)),
    Layer.provide(Git.defaultLayer),
  ),
)

it.effect("uses custom storage", () =>
  Effect.gen(function* () {
    const s = yield* Storage.Service  // ← now the fresh remappedStorage
    // ...
  }).pipe(Effect.provide(remappedStorage)),
)
```

### `Effect.provide(layer, { local: true })` — alternative

The same `migration/layer-memoization.md` doc documents a second escape hatch: `Effect.provide(layer, { local: true })` opts out of the shared memo map for that one provide call. Equivalent to `Layer.fresh` for most cases:

```ts
.pipe(Effect.provide(remappedStorage, { local: true }))
```

Pick whichever reads better. `Layer.fresh` is reusable across tests; `{ local: true }` is per-provide.

### When to use which

| Scenario | Pattern |
|----------|---------|
| Stub one or two methods of a service | `Layer.mock(Tag)(partial)` |
| Replace whole service with a stateful fake | `Layer.succeed(Tag, Tag.of({ ... }))` or `Layer.unwrap(Effect.gen(...))` for a closure-stateful fake |
| Override a service for one test that's already in `testEffect`'s layer | wrap override in `Layer.fresh(...)` (or use `{ local: true }`) |
| Provide test clock | base on `it.effect` (already includes `TestClock`) |
| Need real OS clock / FS / subprocess | use `it.live` |

---

## Test Syntax Migration

### Before: Standard Async Tests

```typescript
// Traditional async test pattern
import { test, expect } from "bun:test";

async function user(sessionID: SessionID, text: string) {
  const session = await Session.getService();
  const msg = await session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    time: { created: Date.now() },
  });
  await session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  });
  return msg;
}

test("loop returns assistant message", async () => {
  const session = await Session.create({});
  await user(session.id, "hello");

  const result = await SessionPrompt.loop({ sessionID: session.id });
  expect(result.info.role).toBe("assistant");
});
```

### After: Effect.gen Tests

```typescript
// Effect test pattern
import { Effect } from "effect";
import { expect } from "bun:test";
import { testEffect } from "../lib/effect";

const user = Effect.fn("test.user")(function* (
  sessionID: SessionID,
  text: string,
) {
  const session = yield* Session.Service;
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    time: { created: Date.now() },
  });
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  });
  return msg;
});

const it = testEffect(env);

it.effect("loop returns assistant message", () =>
  Effect.gen(function* () {
    const session = yield* Session.Service;
    const chat = yield* session.create({});
    yield* user(chat.id, "hello");

    const result = yield* SessionPrompt.Service.pipe(
      Effect.flatMap((svc) => svc.loop({ sessionID: chat.id })),
    );
    expect(result.info.role).toBe("assistant");
  }),
);
```

### Scoped Tests with Cleanup

```typescript
import { Effect } from "effect";
import * as Scope from "effect/Scope";

it.effect(
  "scoped resource test",
  () =>
    Effect.gen(function* () {
      const resource = yield* Effect.acquireRelease(
        Effect.succeed({ data: "value" }),
        (res) =>
          Effect.sync(() => {
            console.log("Cleanup:", res);
          }),
      );

      expect(resource.data).toBe("value");
    }).pipe(Effect.scoped), // Resources cleaned up after test
);
```

---

## Providing Dependencies

### Layer.mergeAll for Test Dependencies

Build your layer stack by merging all required services:

```typescript
import { Layer } from "effect";
import { NodeFileSystem } from "@effect/platform-node";

// Infrastructure layer
const infra = Layer.mergeAll(
  NodeFileSystem.layer,
  CrossSpawnSpawner.defaultLayer,
);

// Core dependencies
const deps = Layer.mergeAll(
  Session.defaultLayer,
  Snapshot.defaultLayer,
  AgentSvc.defaultLayer,
  Permission.layer,
  Plugin.defaultLayer,
  Config.defaultLayer,
  status,
  llm, // Mock LLM layer
).pipe(Layer.provideMerge(infra));

// Feature-specific layers
const registry = ToolRegistry.layer.pipe(Layer.provideMerge(deps));
const trunc = Truncate.layer.pipe(Layer.provideMerge(deps));
const proc = SessionProcessor.layer.pipe(Layer.provideMerge(deps));

// Full environment
const env = SessionPrompt.layer.pipe(
  Layer.provideMerge(compact),
  Layer.provideMerge(proc),
  Layer.provideMerge(registry),
  Layer.provideMerge(trunc),
  Layer.provideMerge(deps),
);
```

### Test-Specific Layers with Mock Implementations

```typescript
// Creating a test-specific mock layer
const llm = Layer.unwrap(
  Effect.gen(function* () {
    const queue: Script[] = [];
    const inputs: LLM.StreamInput[] = [];
    let calls = 0;

    const push = Effect.fn("TestLLM.push")((item: Script) => {
      queue.push(item);
      return Effect.void;
    });

    const reply = Effect.fn("TestLLM.reply")((...items: LLM.Event[]) =>
      push(stream(...items)),
    );

    return Layer.mergeAll(
      Layer.succeed(
        LLM.Service,
        LLM.Service.of({
          stream: (input) => {
            calls += 1;
            inputs.push(input);
            const item = queue.shift() ?? Stream.empty;
            return typeof item === "function" ? item(input) : item;
          },
        }),
      ),
      Layer.succeed(
        TestLLM,
        TestLLM.of({
          push,
          reply,
          calls: Effect.sync(() => calls),
          inputs: Effect.sync(() => [...inputs]),
        }),
      ),
    );
  }),
);
```

### Effect.provide(layer) in Tests

```typescript
// Using the test helper pattern
const it = testEffect(env);

it.effect("test with provided layer", () =>
  Effect.gen(function* () {
    // All services from env are available via yield*
    const test = yield* TestLLM;
    const prompt = yield* SessionPrompt.Service;

    yield* test.reply(...replyStop("world"));
    yield* user(chat.id, "hello");

    const result = yield* prompt.loop({ sessionID: chat.id });
    expect(result.info.role).toBe("assistant");
  }),
);
```

### Example from Opencode: prompt-effect.test.ts

```typescript
// Comprehensive layer setup from opencode
const llm = Layer.unwrap(
  Effect.gen(function* () {
    const queue: Script[] = [];
    const inputs: LLM.StreamInput[] = [];
    let calls = 0;

    const push = Effect.fn("TestLLM.push")((item: Script) => {
      queue.push(item);
      return Effect.void;
    });

    const reply = Effect.fn("TestLLM.reply")((...items: LLM.Event[]) =>
      push(stream(...items)),
    );

    return Layer.mergeAll(
      Layer.succeed(
        LLM.Service,
        LLM.Service.of({
          stream: (input) => {
            calls += 1;
            inputs.push(input);
            const item = queue.shift() ?? Stream.empty;
            return typeof item === "function" ? item(input) : item;
          },
        }),
      ),
      Layer.succeed(
        TestLLM,
        TestLLM.of({
          push,
          reply,
          calls: Effect.sync(() => calls),
          inputs: Effect.sync(() => [...inputs]),
        }),
      ),
    );
  }),
);

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer));
const infra = Layer.mergeAll(
  NodeFileSystem.layer,
  CrossSpawnSpawner.defaultLayer,
);
const deps = Layer.mergeAll(
  Session.defaultLayer,
  Snapshot.defaultLayer,
  AgentSvc.defaultLayer,
  Command.defaultLayer,
  Permission.layer,
  Plugin.defaultLayer,
  Config.defaultLayer,
  filetime,
  lsp,
  mcp,
  AppFileSystem.defaultLayer,
  status,
  llm,
).pipe(Layer.provideMerge(infra));
const registry = ToolRegistry.layer.pipe(Layer.provideMerge(deps));
const trunc = Truncate.layer.pipe(Layer.provideMerge(deps));
const proc = SessionProcessor.layer.pipe(Layer.provideMerge(deps));
const compact = SessionCompaction.layer.pipe(
  Layer.provideMerge(proc),
  Layer.provideMerge(deps),
);
const env = SessionPrompt.layer.pipe(
  Layer.provideMerge(compact),
  Layer.provideMerge(proc),
  Layer.provideMerge(registry),
  Layer.provideMerge(trunc),
  Layer.provideMerge(deps),
);

const it = testEffect(env);
const unix = process.platform !== "win32" ? it.effect : it.effect.skip;

// Test usage
it.effect("loop exits immediately when last assistant has stop finish", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const { test, prompt, chat } = yield* boot();
        yield* seed(chat.id, { finish: "stop" });

        const result = yield* prompt.loop({ sessionID: chat.id });
        expect(result.info.role).toBe("assistant");
        if (result.info.role === "assistant")
          expect(result.info.finish).toBe("stop");
        expect(yield* test.calls).toBe(0);
      }),
    { git: true },
  ),
);
```

---

## Mocking with Layer Overrides

### Creating Mock Services

Define a test service using `Context.Service`:

```typescript
import { Context } from "effect";

class TestLLM extends Context.Service<
  TestLLM,
  {
    readonly push: (stream: Script) => Effect.Effect<void>;
    readonly reply: (...items: LLM.Event[]) => Effect.Effect<void>;
    readonly calls: Effect.Effect<number>;
    readonly inputs: Effect.Effect<LLM.StreamInput[]>;
  }
>()("@test/PromptLLM") {}
```

### Layer.succeed for Mock Service

```typescript
// Replace real service with mock
const mockLayer = Layer.succeed(
  LLM.Service,
  LLM.Service.of({
    stream: (input) => {
      calls += 1;
      inputs.push(input);
      const item = queue.shift() ?? Stream.empty;
      return typeof item === "function" ? item(input) : item;
    },
  }),
);

// Test-specific mock service
const testLayer = Layer.succeed(
  TestLLM,
  TestLLM.of({
    push,
    reply,
    calls: Effect.sync(() => calls),
    inputs: Effect.sync(() => [...inputs]),
  }),
);
```

### Overriding Specific Methods for Test Scenarios

```typescript
// Mock that can return different behaviors per call
const llm = Layer.unwrap(
  Effect.gen(function* () {
    const queue: Script[] = [];
    const inputs: LLM.StreamInput[] = [];
    let calls = 0;

    return Layer.succeed(
      LLM.Service,
      LLM.Service.of({
        stream: (input) => {
          calls += 1;
          inputs.push(input);
          const item = queue.shift() ?? Stream.empty;
          return typeof item === "function" ? item(input) : item;
        },
      }),
    );
  }),
);

// Queue specific responses for tests
function* setupTest() {
  const test = yield* TestLLM;

  // Queue a response
  yield* test.reply(
    start(),
    textStart("t"),
    textDelta("t", "hello"),
    textEnd("t"),
    finishStep(),
    finish(),
  );

  // Or queue a failure
  yield* test.push(Stream.fail(new Error("boom")));

  // Or queue a hang (never completes)
  yield* test.push((input) =>
    stream(...items).pipe(Stream.concat(Stream.fromEffect(Effect.never))),
  );
}
```

### Mock for Non-Effect Services (Bun spy)

```typescript
import { spyOn } from "bun:test";
import { Effect } from "effect";
import z from "zod";

it.effect("test with spy", () =>
  Effect.gen(function* () {
    const init = spyOn(TaskTool, "init").mockImplementation(async () => ({
      description: "task",
      parameters: z.object({
        description: z.string(),
        prompt: z.string(),
        subagent_type: z.string(),
      }),
      execute: async (_args, ctx) => {
        ctx.abort.addEventListener("abort", () => aborted.resolve(), {
          once: true,
        });
        await new Promise<void>(() => {}); // Hang forever
        return { title: "", metadata: {}, output: "" };
      },
    }));

    // Add cleanup
    yield* Effect.addFinalizer(() => Effect.sync(() => init.mockRestore()));

    // Test logic
    expect(init).toHaveBeenCalled();
  }),
);
```

---

## Assertions

### Using Vitest Assertions Inside Effect.gen

```typescript
import { expect } from "bun:test";
import { Effect } from "effect";

it.effect("basic assertions", () =>
  Effect.gen(function* () {
    const session = yield* Session.Service;
    const chat = yield* session.create({});

    // Standard vitest assertions work normally
    expect(chat.id).toBeDefined();
    expect(chat.info.role).toBe("assistant");
    expect(yield* session.count()).toBeGreaterThan(0);
  }),
);
```

### Testing Effect Failures with Effect.exit

```typescript
import { Exit, Cause } from "effect";

it.effect("test failures with exit", () =>
  Effect.gen(function* () {
    const exit = yield* someFailingEffect.pipe(Effect.exit);

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      // Check cause type
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);

      // Get the error
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(Session.BusyError);
    }
  }),
);
```

### Asserting on Typed Errors

```typescript
import { Effect, Exit, Cause } from "effect";

class MyError extends Schema.TaggedErrorClass<MyError>()("MyError", {
  code: Schema.String,
}) {}

it.effect("assert typed errors", () =>
  Effect.gen(function* () {
    const result = yield* Effect.fail(new MyError({ code: "test" })).pipe(
      Effect.exit,
    );

    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      const error = Cause.squash(result.cause);
      expect(error).toBeInstanceOf(MyError);
      expect(error.code).toBe("test");
    }
  }),
);
```

### Asserting Exit Success

```typescript
it.effect("assert exit success", () =>
  Effect.gen(function* () {
    const fiber = yield* someLongRunningEffect.pipe(Effect.forkChild);

    // Do something...
    yield* Effect.sleep("100 millis");

    const exit = yield* Fiber.await(fiber);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toMatchObject({ status: "done" });
    }
  }),
);
```

---

## Test Utilities

### Effect.scoped for Resource Cleanup

```typescript
import { Effect } from "effect";

it.effect("scoped resource management", () =>
  Effect.gen(function* () {
    // Resource is acquired
    const handle = yield* Effect.acquireRelease(
      Effect.sync(() => openResource()),
      (handle) => Effect.sync(() => closeResource(handle)),
    );

    // Use resource
    yield* useResource(handle);

    // Resource is automatically cleaned up after test
  }).pipe(Effect.scoped),
);
```

### Test Clocks for Time-Based Effects

```typescript
import { Effect, Fiber, TestClock } from "effect";

it.effect("time-based test", () =>
  Effect.gen(function* () {
    const clock = yield* TestClock.TestClock;

    // Set initial time
    yield* clock.setTime(0);

    // Start operation
    const fiber = yield* scheduledOperation.pipe(Effect.forkChild);

    // Advance time
    yield* clock.adjust("1 minute");

    // Assert results
    const result = yield* Fiber.join(fiber);
    expect(result).toBeDefined();
  }).pipe(Effect.provide(TestClock.layer)),
);
```

### Controlled Random for Reproducible Tests

```typescript
import { Effect, Random } from "effect";

it.effect("reproducible random", () =>
  Effect.gen(function* () {
    // Seed random for reproducibility
    const random = yield* Random.Random;
    yield* Random.setSeed(12345);

    const value1 = yield* random.nextIntBetween(1, 100);
    const value2 = yield* random.nextIntBetween(1, 100);

    // Values will always be the same in this test
    expect(value1).toBe(42); // Deterministic
    expect(value2).toBe(17); // Deterministic
  }),
);
```

### Forking and Joining Fibers

```typescript
import { Effect, Fiber } from "effect";

it.effect("fiber testing", () =>
  Effect.gen(function* () {
    // Fork concurrent work
    const fiber = yield* longRunningTask.pipe(Effect.forkChild);

    // Do other work concurrently
    yield* otherTask;

    // Wait for result
    const result = yield* Fiber.join(fiber);
    expect(result).toBe("done");
  }),
);

// Testing fiber interruption
it.effect("fiber interruption", () =>
  Effect.gen(function* () {
    const fiber = yield* Effect.never.pipe(Effect.forkChild);

    yield* Fiber.interrupt(fiber);

    const exit = yield* Fiber.await(fiber);
    expect(Exit.isFailure(exit)).toBe(true);
    expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
  }),
);
```

### Concurrent Test Execution

```typescript
it.effect("concurrent callers", () =>
  Effect.gen(function* () {
    const { prompt, chat } = yield* boot();
    yield* seed(chat.id, { finish: "stop" });

    // Run multiple operations concurrently
    const [a, b] = yield* Effect.all(
      [
        prompt.loop({ sessionID: chat.id }),
        prompt.loop({ sessionID: chat.id }),
      ],
      { concurrency: "unbounded" },
    );

    // Both get the same result
    expect(a.info.id).toBe(b.info.id);
    expect(a.info.role).toBe("assistant");
  }),
);
```

---

## Migration from Jest/Vitest Standard

### Replacing Mocks with Effect Service Mocks

**Before (Jest/Vitest spy):**

```typescript
import { spyOn } from "bun:test";

test("mock with spy", async () => {
  const getModel = spyOn(Provider, "getModel").mockImplementation(async () => ({
    // mock implementation
  }));

  try {
    await someOperation();
    expect(getModel).toHaveBeenCalled();
  } finally {
    getModel.mockRestore();
  }
});
```

**After (Effect layer):**

```typescript
const mockProviderLayer = Layer.succeed(
  Provider.Service,
  Provider.Service.of({
    getModel: (providerID, modelID) =>
      Effect.succeed({
        // mock implementation
      }),
  }),
);

const it = testEffect(mockProviderLayer);

it.effect("mock with layer", () =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service;

    // Mock is automatically available
    const model = yield* provider.getModel(id1, id2);
    expect(model).toBeDefined();
  }),
);
```

### Async Test Patterns to Effect.gen

**Before:**

```typescript
test("async sequence", async () => {
  const session = await Session.create({});
  await Session.updateMessage({
    id: MessageID.ascending(),
    sessionID: session.id,
    role: "user",
  });
  const result = await Session.get({ sessionID: session.id });
  expect(result).toBeDefined();
});
```

**After:**

```typescript
it.effect("effect sequence", () =>
  Effect.gen(function* () {
    const session = yield* Session.Service;
    const chat = yield* session.create({});
    yield* session.updateMessage({
      id: MessageID.ascending(),
      sessionID: chat.id,
      role: "user",
    });
    const result = yield* session.get({ sessionID: chat.id });
    expect(result).toBeDefined();
  }),
);
```

### beforeEach/afterEach with Effect Layers

**Before:**

```typescript
let session: Session

beforeEach(async () => {
  session = await Session.create({ title: "test" })
})

afterEach(async () => {
  await Session.delete(session.id)
})

test("uses session", async () => {
  await Session.updateMessage({ sessionID: session.id, ... })
})
```

**After:**

```typescript
// Use Effect.scoped for automatic cleanup
const setupTest = Effect.gen(function* () {
  const session = yield* Session.Service
  const chat = yield* session.create({ title: "test" })

  // Cleanup automatically runs when scope closes
  yield* Effect.addFinalizer(() =>
    session.delete(chat.id).pipe(Effect.ignore)
  )

  return chat
})

it.effect("uses session", () =>
  Effect.gen(function* () {
    const chat = yield* setupTest
    yield* Session.Service.pipe(
      Effect.flatMap(s => s.updateMessage({ sessionID: chat.id, ... }))
    )
  }).pipe(Effect.scoped)
)
```

---

## Examples from Opencode

### Complete Test File Structure

**File: `packages/opencode/test/session/processor-effect.test.ts`**

```typescript
import { NodeFileSystem } from "@effect/platform-node";
import { expect } from "bun:test";
import { APICallError } from "ai";
import { Cause, Effect, Exit, Fiber, Layer, Context } from "effect";
import * as Stream from "effect/Stream";
import path from "path";

// Import all services
import { Agent as AgentSvc } from "../../src/agent/agent";
import { Bus } from "../../src/bus";
import { Config } from "../../src/config/config";
import { Permission } from "../../src/permission";
import { Plugin } from "../../src/plugin";
import { Provider } from "../../src/provider/provider";
import { ModelID, ProviderID } from "../../src/provider/schema";
import { Session } from "../../src/session";
import { LLM } from "../../src/session/llm";
import { MessageV2 } from "../../src/session/message-v2";
import { SessionProcessor } from "../../src/session/processor";
import { MessageID, PartID, SessionID } from "../../src/session/schema";
import { SessionStatus } from "../../src/session/status";
import { Snapshot } from "../../src/snapshot";
import { Log } from "../../src/util/log";
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner";

// Test utilities
import { provideTmpdirInstance } from "../fixture/fixture";
import { testEffect } from "../lib/effect";

// Initialize logging
Log.init({ print: false });

// Test constants
const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
};

// Type helpers
type Script =
  | Stream.Stream<LLM.Event, unknown>
  | ((input: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown>);

// Test service definition
class TestLLM extends Context.Service<
  TestLLM,
  {
    readonly push: (stream: Script) => Effect.Effect<void>;
    readonly reply: (...items: LLM.Event[]) => Effect.Effect<void>;
    readonly calls: Effect.Effect<number>;
    readonly inputs: Effect.Effect<LLM.StreamInput[]>;
  }
>()("@test/SessionProcessorLLM") {}

// Event factory functions
function stream(...items: LLM.Event[]) {
  return Stream.make(...items);
}

function usage(input = 1, output = 1, total = input + output) {
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: undefined,
    },
  };
}

function start(): LLM.Event {
  return { type: "start" };
}

function textStart(id = "t"): LLM.Event {
  return { type: "text-start", id };
}

function textDelta(id: string, text: string): LLM.Event {
  return { type: "text-delta", id, text };
}

function textEnd(id = "t"): LLM.Event {
  return { type: "text-end", id };
}

function finishStep(): LLM.Event {
  return {
    type: "finish-step",
    finishReason: "stop",
    rawFinishReason: "stop",
    response: { id: "res", modelId: "test-model", timestamp: new Date() },
    providerMetadata: undefined,
    usage: usage(),
  };
}

function finish(): LLM.Event {
  return {
    type: "finish",
    finishReason: "stop",
    rawFinishReason: "stop",
    totalUsage: usage(),
  };
}

function fail<E>(err: E, ...items: LLM.Event[]) {
  return stream(...items).pipe(Stream.concat(Stream.fail(err)));
}

function hang(_input: LLM.StreamInput, ...items: LLM.Event[]) {
  return stream(...items).pipe(Stream.concat(Stream.fromEffect(Effect.never)));
}

// Test helpers
function model(context: number): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: { context, output: 10 },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model;
}

function agent(): Agent.Info {
  return {
    name: "build",
    mode: "primary",
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  };
}

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Test data factories
const user = Effect.fn("TestSession.user")(function* (
  sessionID: SessionID,
  text: string,
) {
  const session = yield* Session.Service;
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  });
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  });
  return msg;
});

const assistant = Effect.fn("TestSession.assistant")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  root: string,
) {
  const session = yield* Session.Service;
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  };
  yield* session.updateMessage(msg);
  return msg;
});

// Layer definitions
const llm = Layer.unwrap(
  Effect.gen(function* () {
    const queue: Script[] = [];
    const inputs: LLM.StreamInput[] = [];
    let calls = 0;

    const push = Effect.fn("TestLLM.push")((item: Script) => {
      queue.push(item);
      return Effect.void;
    });

    const reply = Effect.fn("TestLLM.reply")((...items: LLM.Event[]) =>
      push(stream(...items)),
    );
    return Layer.mergeAll(
      Layer.succeed(
        LLM.Service,
        LLM.Service.of({
          stream: (input) => {
            calls += 1;
            inputs.push(input);
            const item = queue.shift() ?? Stream.empty;
            return typeof item === "function" ? item(input) : item;
          },
        }),
      ),
      Layer.succeed(
        TestLLM,
        TestLLM.of({
          push,
          reply,
          calls: Effect.sync(() => calls),
          inputs: Effect.sync(() => [...inputs]),
        }),
      ),
    );
  }),
);

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer));
const infra = Layer.mergeAll(
  NodeFileSystem.layer,
  CrossSpawnSpawner.defaultLayer,
);
const deps = Layer.mergeAll(
  Session.defaultLayer,
  Snapshot.defaultLayer,
  AgentSvc.defaultLayer,
  Permission.layer,
  Plugin.defaultLayer,
  Config.defaultLayer,
  status,
  llm,
).pipe(Layer.provideMerge(infra));
const env = SessionProcessor.layer.pipe(Layer.provideMerge(deps));

// Create test helper
const it = testEffect(env);

// Tests
it.effect("session.processor effect tests capture llm input cleanly", () => {
  return provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const test = yield* TestLLM;
        const processors = yield* SessionProcessor.Service;
        const session = yield* Session.Service;

        yield* test.reply(
          start(),
          textStart(),
          textDelta("t", "hello"),
          textEnd(),
          finishStep(),
          finish(),
        );

        const chat = yield* session.create({});
        const parent = yield* user(chat.id, "hi");
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir));
        const mdl = model(100);
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        });

        const input = {
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "hi" }],
          tools: {},
        } satisfies LLM.StreamInput;

        const value = yield* handle.process(input);
        const parts = yield* Effect.promise(() => MessageV2.parts(msg.id));
        const calls = yield* test.calls;
        const inputs = yield* test.inputs;

        expect(value).toBe("continue");
        expect(calls).toBe(1);
        expect(inputs).toHaveLength(1);
        expect(inputs[0].messages).toStrictEqual([
          { role: "user", content: "hi" },
        ]);
        expect(
          parts.some((part) => part.type === "text" && part.text === "hello"),
        ).toBe(true);
      }),
    { git: true },
  );
});

it.effect(
  "session.processor effect tests stop after token overflow requests compaction",
  () => {
    return provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const test = yield* TestLLM;
          const processors = yield* SessionProcessor.Service;
          const session = yield* Session.Service;

          yield* test.reply(
            start(),
            {
              type: "finish-step",
              finishReason: "stop",
              rawFinishReason: "stop",
              response: {
                id: "res",
                modelId: "test-model",
                timestamp: new Date(),
              },
              providerMetadata: undefined,
              usage: usage(100, 0, 100),
            },
            textStart(),
            textDelta("t", "after"),
            textEnd(),
          );

          const chat = yield* session.create({});
          const parent = yield* user(chat.id, "compact");
          const msg = yield* assistant(chat.id, parent.id, path.resolve(dir));
          const mdl = model(20);
          const handle = yield* processors.create({
            assistantMessage: msg,
            sessionID: chat.id,
            model: mdl,
          });

          const value = yield* handle.process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "compact" }],
            tools: {},
          });

          const parts = yield* Effect.promise(() => MessageV2.parts(msg.id));

          expect(value).toBe("compact");
          expect(parts.some((part) => part.type === "text")).toBe(false);
          expect(parts.some((part) => part.type === "step-finish")).toBe(true);
        }),
      { git: true },
    );
  },
);
```

### How Tests Provide Complex Dependency Graphs

```typescript
// Layer composition for complex scenarios
const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
    authenticate: () =>
      Effect.die("unexpected MCP auth in prompt-effect tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
);

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
);

const filetime = Layer.succeed(
  FileTime.Service,
  FileTime.Service.of({
    read: () => Effect.void,
    get: () => Effect.succeed(undefined),
    assert: () => Effect.void,
    withLock: (_filepath, fn) => Effect.promise(fn),
  }),
);

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer));
const infra = Layer.mergeAll(
  NodeFileSystem.layer,
  CrossSpawnSpawner.defaultLayer,
);
const deps = Layer.mergeAll(
  Session.defaultLayer,
  Snapshot.defaultLayer,
  AgentSvc.defaultLayer,
  Command.defaultLayer,
  Permission.layer,
  Plugin.defaultLayer,
  Config.defaultLayer,
  filetime,
  lsp,
  mcp,
  AppFileSystem.defaultLayer,
  status,
  llm,
).pipe(Layer.provideMerge(infra));

// Each feature layer builds on the previous
const registry = ToolRegistry.layer.pipe(Layer.provideMerge(deps));
const trunc = Truncate.layer.pipe(Layer.provideMerge(deps));
const proc = SessionProcessor.layer.pipe(Layer.provideMerge(deps));
const compact = SessionCompaction.layer.pipe(
  Layer.provideMerge(proc),
  Layer.provideMerge(deps),
);
const env = SessionPrompt.layer.pipe(
  Layer.provideMerge(compact),
  Layer.provideMerge(proc),
  Layer.provideMerge(registry),
  Layer.provideMerge(trunc),
  Layer.provideMerge(deps),
);
```

### Testing Effectified Services vs Old Async Tests

**Comparison of old and new test patterns from opencode:**

**Old Pattern (prompt-concurrency.test.ts):**

```typescript
test("concurrent loop callers get the same result", async () => {
  await using tmp = await tmpdir({ git: true });
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({});
      await seed(session.id);

      const [a, b] = await Promise.all([
        SessionPrompt.loop({ sessionID: session.id }),
        SessionPrompt.loop({ sessionID: session.id }),
      ]);

      expect(a.info.id).toBe(b.info.id);
      expect(a.info.role).toBe("assistant");
    },
  });
});
```

**New Effect Pattern (prompt-effect.test.ts):**

```typescript
it.effect("concurrent loop callers get same result", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const { prompt, chat } = yield* boot();
        yield* seed(chat.id, { finish: "stop" });

        const [a, b] = yield* Effect.all(
          [
            prompt.loop({ sessionID: chat.id }),
            prompt.loop({ sessionID: chat.id }),
          ],
          {
            concurrency: "unbounded",
          },
        );

        expect(a.info.id).toBe(b.info.id);
        expect(a.info.role).toBe("assistant");
        yield* prompt.assertNotBusy(chat.id);
      }),
    { git: true },
  ),
);
```

### Key Differences

1. **Cleanup Management**: Old pattern uses `await using` with `tmpdir`, new pattern uses `Effect.scoped` and `provideTmpdirInstance`
2. **Dependency Access**: Old pattern uses `Instance.provide`, new pattern uses `yield*` to access services
3. **Concurrency**: Old pattern uses `Promise.all`, new pattern uses `Effect.all` with controlled concurrency
4. **Error Handling**: New pattern uses `Effect.exit` and `Cause` for structured error handling
5. **Mocking**: Old pattern uses function spies, new pattern uses `Layer.succeed` to replace services

---

## Summary

Migrating tests to Effect v4 with @effect/vitest patterns from opencode involves:

1. **Setup**: Create a test helper like `testEffect` that wraps your test framework with layer provisioning
2. **Dependencies**: Build layer stacks with `Layer.mergeAll` and `Layer.provideMerge`
3. **Mocking**: Use `Layer.succeed` and `Layer.unwrap` to create test-specific service implementations
4. **Tests**: Write tests with `Effect.gen` and `yield*` for dependency injection
5. **Assertions**: Use standard assertions plus `Effect.exit` and `Cause` for failure testing
6. **Cleanup**: Use `Effect.scoped` and `Effect.addFinalizer` for automatic resource cleanup

The key benefits are:

- **Composability**: Layer stacks compose naturally
- **Type Safety**: Full type inference through the dependency graph
- **Testability**: Easy to mock any service in the stack
- **Cleanup**: Automatic resource management via scopes
- **Control**: Fine-grained control over fiber lifecycle and concurrency

---

## Test Setup Helpers (Effect-Native)

When tests need a temporary working directory, real subprocess setup, or any other resource that's typically managed with `try/finally` in async tests, replace those with `Effect.acquireRelease` / `Effect.addFinalizer` so cleanup ties to the test scope.

### `tmpdirScoped` — replace `try/finally` for tmpdir

Pattern:

```ts
import { Effect, FileSystem } from "effect"
import * as path from "node:path"
import * as os from "node:os"

const tmpdirScoped = (options?: { git?: boolean }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const dir = path.join(os.tmpdir(), `test-${crypto.randomUUID()}`)
    yield* fs.makeDirectory(dir, { recursive: true })

    yield* Effect.addFinalizer(() =>
      fs.remove(dir, { recursive: true, force: true }).pipe(Effect.ignore),
    )

    if (options?.git) {
      yield* runGitInit(dir)
    }

    return dir
  })

// Usage in a test
it.live("uses tmpdir", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })
    // ... test logic ...
  }).pipe(Effect.scoped),
)
```

The `Effect.addFinalizer` runs when the enclosing scope closes — `it.live` and friends wrap each test body in `Effect.scoped`, so the directory is cleaned up exactly once per test.

This replaces:

```ts
// ❌ async pattern
test("uses tmpdir", async () => {
  const dir = await mkdtemp(...)
  try {
    // ...
  } finally {
    await rm(dir, { recursive: true })
  }
})
```

### Convert raw `fs`/`Bun.write`/`tmpdir` to `FileSystem.FileSystem`

When porting test setup, swap raw `fs`/`Bun` calls for the `FileSystem` service:

```ts
// ❌ Mixed async/Effect — easy to get cleanup wrong
test("foo", async () => {
  await Bun.write(path, contents)
  // ...
})

// ✅ Pure Effect.gen
const writeJson = Effect.fnUntraced(function* (file: string, value: unknown) {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(path.dirname(file), { recursive: true })
  yield* fs.writeFileString(file, JSON.stringify(value, null, 2))
})

it.live("foo", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    yield* writeJson(path.join(dir, "config.json"), { ok: true })
    // ...
  }).pipe(Effect.scoped),
)
```

You'll need `NodeFileSystem.layer` (or `BunFileSystem.layer`) somewhere in your test base layer for `FileSystem.FileSystem` to resolve.

---

## v4 Test Pitfalls

The three most common ways tests go wrong during a v3 → v4 or async → Effect migration. All three are silent — the test passes or fails for the wrong reason.

### 1. Layer override is silently no-op

```ts
const it = testEffect(Storage.defaultLayer)  // builds Storage, memoizes

it.effect("uses custom storage", () =>
  Effect.gen(function* () {
    const s = yield* Storage.Service
    expect(yield* s.read(key)).toEqual(...)
  }).pipe(
    Effect.provide(customStorage),  // ← LOOKS like an override
  ),
)
```

This silently uses the outer `Storage` from `testEffect`'s memoized layer, **not** `customStorage`. v4's auto-memoization across `Effect.provide` calls means the inner provide hits the cache.

Fix: wrap the override in `Layer.fresh(...)` (preferred for reuse) or pass `{ local: true }`:

```ts
.pipe(Effect.provide(Layer.fresh(customStorage)))
// or
.pipe(Effect.provide(customStorage, { local: true }))
```

See `~/Developer/effect/migration/layer-memoization.md` for full background.

### 2. `Effect.tryPromise` on a service method drops the Promise

When migrating from a facade-style async service:

```ts
// Old facade
const result = yield* Effect.tryPromise(() => Storage.read(key))

// After service migration — service method already returns Effect
const storage = yield* Storage.Service
const result = yield* Effect.tryPromise(() => storage.read(key))  // ❌ double-wrapped
```

The fix is just `yield* storage.read(key)`. If you find yourself reaching for `Effect.tryPromise` on a service method, you're treating the new API like the old one.

### 3. Raw `.layer` test callers break silently in the type checker

Tests that compose `Service.layer` directly (rather than `Service.defaultLayer`) become under-specified the moment the service gains a new dependency:

```ts
const env = Layer.mergeAll(
  Caller.layer,           // ❌ bare — missing newly-added Storage dep
  Bus.defaultLayer,
  Config.defaultLayer,
)
```

`tsgo` flags this as:

> Type 'Storage.Service' is not assignable to type '... | Service | TestConsole'

Two fixes:

```ts
// (a) Switch to defaultLayer
const env = Layer.mergeAll(Caller.defaultLayer, Bus.defaultLayer, Config.defaultLayer)

// (b) Or add the new dep explicitly
const env = Layer.mergeAll(
  Caller.layer.pipe(Layer.provide(Storage.defaultLayer)),
  Bus.defaultLayer,
  Config.defaultLayer,
)
```

This shows up the most after a service migration that adds a yield. The error message is precise; the surprise is that an apparently-unrelated test starts failing.

---

## Related

- `references/patterns/service-effectification.md` — what tests are testing
- `references/ecosystem/vitest.md` — `@effect/vitest` reference
- `~/Developer/effect/migration/layer-memoization.md` — auto-memoization explainer
