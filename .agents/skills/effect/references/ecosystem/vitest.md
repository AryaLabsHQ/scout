# Vitest

## Table of Contents

- [Install](#install)
- [Setup](#setup)
- [Testing Defaults](#testing-defaults)
- [Primary Test Helper: `it.effect()`](#primary-test-helper-iteffect)
- [Test Variants](#test-variants)
- [Per-Test Layer Pattern (Preferred)](#per-test-layer-pattern-preferred)
- [Layer Patterns for Testing](#layer-patterns-for-testing)
- [Test Stub Tiers](#test-stub-tiers)
- [Config in Tests](#config-in-tests)
- [Assertion Helpers](#assertion-helpers)
- [TestClock for Time-Based Tests](#testclock-for-time-based-tests)
- [Property Tests](#property-tests)
- [Synchronization Instead of Sleeps](#synchronization-instead-of-sleeps)
- [Scoped Resources](#scoped-resources)
- [Logging in Tests](#logging-in-tests)
- [Flaky Test Helper](#flaky-test-helper)
- [Complete Worked Example](#complete-worked-example)
- [Opinionated Guidance Summary](#opinionated-guidance-summary)
- [Notes](#notes)

Use `@effect/vitest` for Effect-native testing with Vitest.

**Source:** `@effect/vitest` - see `~/Developer/effect/packages/vitest/src/`

Before choosing test seams or examples, read `testing.md` in the consuming repository's root `docs/`
folder when present. Resolve it from the repository root, not relative to this installed skill. That
file owns project test policy and exemplar paths; this reference owns the API guidance.

## Install

```bash
bun add -D vitest @effect/vitest@4.0.0
```

Pin `@effect/vitest` to the same version as `effect`. It peers `vitest >=5.0.0 <6.0.0`. The `beta`
and `rc` dist-tags are older prereleases, not this skill's baseline.

## Setup

Create a `vitest.setup.ts` with equality testers for proper Effect value comparison:

```typescript
import { addEqualityTesters } from "@effect/vitest";

addEqualityTesters();
```

Update `vitest.config.ts` to use the setup file:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

Update your test script:

```json
// package.json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

## Testing Defaults

- Reach for `it.effect` by default; use `it.live` only when real time or a live runtime service is
  the behavior under test.
- Prefer test layers and `ConfigProvider` over mutating global state.
- Drive time with `TestClock.setTime` / `TestClock.adjust` for sleeps, schedules, retries, leases,
  and timeouts. Fork sleeping effects before advancing the `TestClock`.
- Avoid arbitrary `Effect.sleep(...)` in tests — it makes them slow and flaky. Coordinate fibers
  with synchronization primitives instead (see
  [Synchronization Instead of Sleeps](#synchronization-instead-of-sleeps)).
- Assert the hard cases where they apply: typed failures, rollback, interruption, finalization,
  retry bounds, idempotency, and malformed persistence.

## Primary Test Helper: `it.effect()`

Use `it.effect()` as your primary test helper. It handles Effect execution, scoped resources, and
provides detailed fiber failure reporting.

```ts
import { Effect } from "effect";
import { assert, describe, it } from "@effect/vitest";

describe("Calculator", () => {
  // Sync test - regular function (rarely needed)
  it("creates instances", () => {
    const result = 1 + 1;
    assert.strictEqual(result, 2);
  });

  // Effect test - returns Effect (preferred)
  it.effect("adds numbers", () =>
    Effect.gen(function* () {
      const result = yield* Effect.succeed(1 + 1);
      assert.strictEqual(result, 2);
    }),
  );
});
```

## Test Variants

| Function                | When to use                              |
| ----------------------- | ---------------------------------------- |
| `it.effect`             | **Primary**: Most Effect tests (default) |
| `it.live`               | Real clock/tests needing actual delays   |
| `it.effect.fails`       | Test expected to fail (documents bugs)   |
| `it.effect.skip`        | Temporarily disable a test               |
| `it.effect.only`        | Run only this test (focus mode)          |
| `it.effect.each(cases)` | Parametrized tests                       |

### `it.live()` - Real Clock Tests

Use `it.live()` when you need real clock behavior instead of TestClock:

```ts
import { Clock, Effect } from "effect";

// it.effect provides TestContext - clock starts at 0
it.effect("test clock starts at zero", () =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    assert.strictEqual(now, 0);
  }),
);

// it.live uses real system clock
it.live("real clock returns actual time", () =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    assert.isAbove(now, 0); // Actual system time
  }),
);
```

### Test Modifiers

```ts
// Skip a test temporarily
it.effect.skip("disabled for now", () =>
  Effect.gen(function* () {
    // Won't run
  }),
);

// Run only this test (focus mode)
it.effect.only("focus here", () =>
  Effect.gen(function* () {
    // Only this runs
  }),
);

// Expect a test to fail (documents known bugs)
it.effect.fails("known bug - should be fixed", () =>
  Effect.gen(function* () {
    assert.strictEqual(1 + 1, 3); // Expected to fail
  }),
);
```

## Per-Test Layer Pattern (Preferred)

**Opinionated guidance**: Use `Effect.provide(layer)` per test instead of `it.layer()`. This avoids
state leakage between tests and makes each test self-contained.

```ts
import { Effect, Layer, Context } from "effect";

class Database extends Context.Service<
  Database,
  { query: (sql: string) => Effect.Effect<string[]> }
>()("Database") {}

// A static stub is the whole implementation
const testDatabase = Layer.succeed(Database, {
  query: (_sql) => Effect.succeed(["mock", "data"]),
});

it.effect(
  "queries database",
  () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const results = yield* db.query("SELECT * FROM users");
      assert.strictEqual(results.length, 2);
    }).pipe(Effect.provide(testDatabase)), // Per-test provision
);
```

## Layer Patterns for Testing

### `Layer.provideMerge()` - Exposing Leaf Services

Use `Layer.provideMerge()` to compose layers while exposing leaf services for test setup and
assertions. This is critical for testing orchestrated services.

```ts
import { Effect, Layer, Context, Clock } from "effect";

// Leaf service (own module: users.ts, self-exported as Users)
class Users extends Context.Service<Users, { findById: (id: string) => Effect.Effect<string> }>()(
  "@app/Users",
) {}

const usersTestLayer = Layer.succeed(Users, {
  findById: (_id) => Effect.succeed("Alice"),
});

// Orchestrating service (own module: events.ts)
class Events extends Context.Service<
  Events,
  { register: (userId: string) => Effect.Effect<string> }
>()("@app/Events") {}

const eventsLayer = Layer.effect(
  Events,
  Effect.gen(function* () {
    const users = yield* Users;
    return {
      register: (userId: string) =>
        Effect.gen(function* () {
          const user = yield* users.findById(userId);
          return `Registered: ${user}`;
        }),
    };
  }),
);

// provideMerge exposes leaf services in tests for setup/assertions
const testLayer = eventsLayer.pipe(Layer.provideMerge(usersTestLayer));

it.effect("registers user", () =>
  Effect.gen(function* () {
    const events = yield* Events;
    const users = yield* Users; // Accessible thanks to provideMerge

    // Can use users service for setup/assertions
    const result = yield* events.register("user-123");
    assert.strictEqual(result, "Registered: Alice");
  }).pipe(Effect.provide(testLayer)),
);
```

## Test Stub Tiers

Match the stub to what the test actually needs. In increasing order of capability:

### Tier 1 — `Layer.succeed` for static stubs

When the fake is a fixed set of return values with no state, `Layer.succeed` is the whole
implementation:

```ts
const testDatabase = Layer.succeed(Database, {
  query: (_sql) => Effect.succeed(["mock", "data"]),
});
```

### Tier 2 — dual-tag `TestService` for reusable, stateful fakes

House pattern for fakes that accumulate state, inject failures, or expose inspection. The trick: one
backing object is registered under **two** tags — the real `Service` tag that production depends on,
and a `TestService` tag whose interface extends the real one with test-only controls. Production
code only ever sees the real interface; tests reach for `TestService` to drive and inspect.

Write it in the [namespace-module style](../dependency-injection/service.md#module-surface): a file
with file-local `Interface` / `Service` / `TestService` / `testLayer`, self-exported at the bottom.

```ts
// notifier.ts
import { Context, Effect, Layer, Option, Ref } from "effect";

export interface Interface {
  readonly send: (message: Message) => Effect.Effect<void, SendError>;
}

export class Service extends Context.Service<Service, Interface>()("@app/Notifier") {}

// The test surface extends the production surface with inspection + failure injection.
export interface TestInterface extends Interface {
  readonly sentMessages: () => Effect.Effect<ReadonlyArray<Message>>;
  readonly failNextSend: (error: SendError) => Effect.Effect<void>;
}

export class TestService extends Context.Service<TestService, TestInterface>()(
  "@app/Notifier/Test",
) {}

// One object backs BOTH tags, wired up with Layer.effectContext.
export const testLayer = Layer.effectContext(
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<Message>>([]);
    const nextFailure = yield* Ref.make<Option.Option<SendError>>(Option.none());

    const service = TestService.of({
      send: Effect.fn("Notifier.Test.send")(function* (message) {
        const failure = yield* Ref.getAndSet(nextFailure, Option.none());
        if (Option.isSome(failure)) return yield* Effect.fail(failure.value);
        yield* Ref.update(sent, (messages) => [...messages, message]);
      }),
      sentMessages: Effect.fn("Notifier.Test.sentMessages")(function* () {
        return yield* Ref.get(sent);
      }),
      failNextSend: Effect.fn("Notifier.Test.failNextSend")(function* (error) {
        yield* Ref.set(nextFailure, Option.some(error));
      }),
    });

    return Context.empty().pipe(Context.add(Service, service), Context.add(TestService, service));
  }),
);

export * as Notifier from "./notifier";
```

A test provides `Notifier.testLayer`, resolves `Notifier.TestService` for control, and exercises the
code under test through `Notifier.Service`:

```ts
import { Notifier } from "./notifier";

it.effect("surfaces an injected send failure", () =>
  Effect.gen(function* () {
    const notifier = yield* Notifier.TestService;
    yield* notifier.failNextSend(new SendError());

    // ... run the code under test, which depends only on Notifier.Service ...

    const sent = yield* notifier.sentMessages();
    assert.strictEqual(sent.length, 0);
  }).pipe(Effect.provide(Notifier.testLayer)),
);
```

Guidance:

- The same object backs both tags. Production depends only on the real `Service` tag; tests use
  `TestService` for control and inspection.
- Keep every member function-valued — including zero-argument operations like `sentMessages` — so
  `Effect.fn` fits and the shape stays uniform.
- When inspection can safely live on the service's own interface and you don't need the
  production/test split, a `testLayer` built with `Layer.sync` over local mutable state is the
  lighter form. Mutable `Map`s, arrays, and counters are fine — JavaScript is single-threaded:

```ts
import { Effect, Layer, Context, Option } from "effect";

class Users extends Context.Service<
  Users,
  {
    readonly create: (user: { id: string; name: string }) => Effect.Effect<void>;
    readonly findById: (id: string) => Effect.Effect<{ id: string; name: string }>;
  }
>()("@app/Users") {}

const testLayer = Layer.sync(Users, () => {
  const store = new Map<string, { id: string; name: string }>();

  return {
    create: (user) => Effect.sync(() => void store.set(user.id, user)),
    findById: (id) =>
      Effect.gen(function* () {
        const user = Option.fromNullishOr(store.get(id));
        if (Option.isNone(user)) {
          return yield* Effect.fail(new Error(`User ${id} not found`));
        }
        return user.value;
      }),
  };
});
```

### Tier 3 — `Layer.mock` for partial stubs

When a test touches only a few methods of a large service, `Layer.mock` implements just those. Any
omitted member dies with `UnimplementedError` if it is ever called, so gaps fail loudly instead of
silently returning `undefined`:

```ts
const testUsers = Layer.mock(Users, {
  findById: (id) => Effect.succeed({ id, name: "Test User" }),
  // create / update / delete omitted — calling them dies with UnimplementedError
});
```

Reserve `Layer.mock` for tiny partial fakes; prefer Tier 1 or Tier 2 when the test exercises the
whole surface.

## Config in Tests

Two modes, depending on whether the test should exercise config decoding:

- **Exercise decoding** — wrap raw values in a provider so `Config` decoding runs as it would in
  production:

```ts
import { Config, ConfigProvider, Effect } from "effect";

const TestConfig = ConfigProvider.layer(ConfigProvider.fromUnknown({ port: 8080 }));

it.effect("reads the port", () =>
  Effect.gen(function* () {
    const port = yield* Config.Number("port");
    assert.strictEqual(port, 8080);
  }).pipe(Effect.provide(TestConfig)),
);
```

- **Skip decoding** — when the app wraps already-decoded config in its own service, hand the service
  the finished value directly:

```ts
const TestConfig = Layer.succeed(AppConfig.Service, {
  port: 8080,
  host: "localhost",
});
```

Reach for `ConfigProvider.fromUnknown` only when env/config decoding is part of what you are
testing; otherwise `Layer.succeed` on the config service is simpler and more explicit.

## Assertion Helpers

Import assertion utilities from `@effect/vitest/utils`:

```ts
import { assertSuccess, assertFailure, assertTrue, strictEqual } from "@effect/vitest/utils";
import { Effect } from "effect";

it.effect("assertion helpers", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(Effect.succeed("hello"));
    assertSuccess(result, "hello");

    const errorResult = yield* Effect.result(Effect.fail(new Error("oops")));
    assertFailure(errorResult, new Error("oops"));

    const flag = true;
    assertTrue(flag);

    strictEqual(1 + 1, 2);
  }),
);
```

## TestClock for Time-Based Tests

Use `TestClock.adjust()` to simulate time advancement in tests. Fork the sleeping effect first, then
advance the clock:

```ts
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

it.effect("simulates time passage", () =>
  Effect.gen(function* () {
    // Fork an effect that delays for 10 seconds
    const fiber = yield* Effect.delay(Effect.succeed("done"), "10 seconds").pipe(Effect.forkChild);

    // Advance time by 10 seconds
    yield* TestClock.adjust("10 seconds");

    // Fiber completes immediately after time adjustment
    const result = yield* Fiber.join(fiber);
    assert.strictEqual(result, "done");
  }),
);
```

Use `TestClock.setTime(timestamp)` to jump to an absolute instant instead of advancing by a duration
— useful for deadline, lease, and calendar-boundary tests.

## Schema round trips with `TestSchema`

`TestSchema.Asserts` (`effect/testing`, `@stability unstable`) wraps a schema for assertions.
`verifyRoundTripEffect` is lazy and runs in the calling fiber, so decoding/encoding services and the
test clock apply. A mismatch is a defect carrying the shrunk input and replay token.

```ts
import { it } from "@effect/vitest";
import { Schema } from "effect";
import { TestSchema } from "effect/testing";

it.effect("NumberFromString round-trips", () =>
  new TestSchema.Asserts(Schema.NumberFromString).verifyRoundTripEffect({ seed: 1, runs: 20 }),
);
```

## Property Tests

`it.prop` and `it.effect.prop` accept `Schema` values or native `Arbitrary` values. The callback
receives generated inputs; return `false` (or fail the Effect) to falsify the property and trigger
shrinking. `it.effect.prop` is the Effectful form when the property needs services, deterministic
time, or other requirements.

```ts
import { Schema } from "effect";
import { it } from "@effect/vitest";

it.prop("reversing twice is identity", [Schema.Array(Schema.Int)], ([values]) =>
  values
    .slice()
    .reverse()
    .reverse()
    .every((value, index) => value === values[index]),
);
```

Pass the fourth `it.prop` / `it.effect.prop` argument for the Vitest timeout; arbitrary generation
and shrinking options are configured through the property-test options object.

## Synchronization Instead of Sleeps

`Effect.sleep` in a test trades determinism for wall-clock time and flakiness. When you need to wait
for a fiber to reach a point, wait on a synchronization primitive it signals — not a timer:

- `Deferred` — a one-shot readiness/completion signal.
- `Queue` — hand test-controlled work, or observed events, across fibers.
- `Latch` — a reusable open/close gate (`Latch.make`, `Latch.open`, `Latch.close`,
  `Latch.whenOpen`).
- `Ref` — shared observation state the test inspects.
- An explicit test hook, when the production boundary can expose a deterministic synchronization
  point.

```ts
import { Deferred, Effect, Queue } from "effect";

it.effect("publishes exactly once", () =>
  Effect.gen(function* () {
    const published = yield* Queue.unbounded<Message>();
    const ready = yield* Deferred.make<void>();

    const worker = makeWorker({
      onReady: () => Deferred.succeed(ready, undefined),
      onPublish: (message) => Queue.offer(published, message),
    });

    yield* Effect.forkScoped(worker);

    // Block on the worker's own readiness signal, not a timer.
    yield* Deferred.await(ready);
    const message = yield* Queue.take(published);

    assert.deepStrictEqual(message, expectedMessage);
  }),
);
```

## Scoped Resources

Scoping is automatic in v4. The scope closes automatically when the test ends, triggering cleanup
finalizers:

```ts
import { FileSystem } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";

it.effect("temp directory is cleaned up", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // makeTempDirectoryScoped creates a directory that's deleted when scope closes
    const tempDir = yield* fs.makeTempDirectoryScoped();

    // Use the temp directory
    yield* fs.writeFileString(`${tempDir}/test.txt`, "hello");
    const exists = yield* fs.exists(`${tempDir}/test.txt`);
    assert.isTrue(exists);

    // When test ends, scope closes and tempDir is deleted automatically
  }).pipe(Effect.provide(NodeFileSystem.layer)),
);
```

## Logging in Tests

By default, `it.effect` suppresses log output. To enable logging:

```ts
import { Effect, Logger } from "effect";

// Option 1: Provide a logger inline
it.effect("with logging", () =>
  Effect.gen(function* () {
    yield* Effect.log("This will be shown");
  }).pipe(Effect.provide(Logger.layer([Logger.consolePretty()]))),
);

// Option 2: Use it.live (logging enabled by default)
it.live("live with logging", () =>
  Effect.gen(function* () {
    yield* Effect.log("This will be shown");
  }),
);
```

## Flaky Test Helper

Retries until the effect succeeds (useful for non-deterministic operations):

`flakyTest` returns an `Effect` and retries the source only when it fails, so run it and give the
source a way to fail:

```ts
import { flakyTest } from "@effect/vitest";
import { Effect } from "effect";

let attempts = 0;
const flaky = flakyTest(
  Effect.suspend(() => {
    attempts += 1;
    return attempts < 2 ? Effect.fail("transient") : Effect.succeed("ok");
  }),
  "1 second",
);

await Effect.runPromise(flaky);
```

## Complete Worked Example

Here's a complete example showing all patterns together:

```ts
import { Clock, Effect, Layer, Option, Schema, Context } from "effect";
import { assert, describe, it } from "@effect/vitest";
import { assertTrue } from "@effect/vitest/utils";

// Domain types
const UserId = Schema.String.pipe(Schema.brand("UserId"));
type UserId = typeof UserId.Type;

class User extends Schema.Class<User>("User")({
  id: UserId,
  name: Schema.String,
}) {}

// Service with test layer
class Users extends Context.Service<
  Users,
  {
    readonly create: (user: User) => Effect.Effect<void>;
    readonly findById: (id: UserId) => Effect.Effect<User>;
  }
>()("@app/Users") {}

const usersTestLayer = Layer.sync(Users, () => {
  const store = new Map<UserId, User>();

  return {
    create: (user) => Effect.sync(() => void store.set(user.id, user)),
    findById: (id) =>
      Effect.gen(function* () {
        const user = Option.fromNullishOr(store.get(id));
        if (Option.isNone(user)) return yield* Effect.fail(new Error("Not found"));
        return user.value;
      }),
  };
});

// Orchestrating service
class Greeter extends Context.Service<
  Greeter,
  { readonly greet: (userId: UserId) => Effect.Effect<string> }
>()("@app/Greeter") {}

const greeterLayer = Layer.effect(
  Greeter,
  Effect.gen(function* () {
    const users = yield* Users;
    return {
      greet: (userId) =>
        Effect.gen(function* () {
          const user = yield* users.findById(userId);
          return `Hello, ${user.name}!`;
        }),
    };
  }),
);

// Compose test layer with provideMerge to expose leaf services
const testLayer = greeterLayer.pipe(Layer.provideMerge(usersTestLayer));

describe("Greeter", () => {
  it.effect("greets a user", () =>
    Effect.gen(function* () {
      const users = yield* Users;
      const greeter = yield* Greeter;

      // Setup via leaf service
      const user = new User({
        id: UserId.make("user-123"),
        name: "Alice",
      });
      yield* users.create(user);

      // Act
      const greeting = yield* greeter.greet(user.id);

      // Assert
      assert.strictEqual(greeting, "Hello, Alice!");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect.fails("fails for unknown user", () =>
    Effect.gen(function* () {
      const greeter = yield* Greeter;
      yield* greeter.greet(UserId.make("unknown"));
    }).pipe(Effect.provide(testLayer)),
  );
});
```

## Opinionated Guidance Summary

1. **Use `it.effect()` as your primary test helper** - Most tests should use this
2. **Per-test `Effect.provide(layer)`** - Avoid `it.layer()` to prevent state leakage between tests
3. **Match the stub to the need** - `Layer.succeed` for static stubs, the dual-tag `TestService`
   pattern for reusable stateful fakes, `Layer.mock` for tiny partial stubs (see
   [Test Stub Tiers](#test-stub-tiers))
4. **Use `Layer.provideMerge()`** - Exposes leaf services for setup and assertions in orchestrated
   service tests
5. **Module-level `testLayer` with `Layer.sync()`** - The lighter form of a stateful fake, when
   inspection can live on the service's own interface
6. **Mutable state is fine in tests** - JavaScript is single-threaded; use Maps, arrays, and
   counters freely in test layers
7. **Drive time with `TestClock`, coordinate with synchronization primitives** - No arbitrary
   `Effect.sleep` in tests
8. **Add `addEqualityTesters()`** - Required in vitest setup file for proper Effect value comparison

## Notes

- `@effect/vitest` requires `vitest` as a peer dependency
- Keep `vitest`, `@effect/vitest`, and `effect` on the same release line
- Use `it.effect.skip` / `it.effect.skipIf` for conditional skipping
