# Vitest

Use `@effect/vitest` for Effect-native testing with Vitest.

**Source:** `@effect/vitest` - see `~/Developer/effect/packages/vitest/src/`

## Install

```bash
bun add -D vitest @effect/vitest@beta
```

## Setup

Create a `vitest.setup.ts` with equality testers for proper Effect value comparison:

```typescript
import { addEqualityTesters } from "@effect/vitest"

addEqualityTesters()
```

Update `vitest.config.ts` to use the setup file:

```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
})
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

## Primary Test Helper: `it.effect()`

Use `it.effect()` as your primary test helper. It handles Effect execution, scoped resources, and provides detailed fiber failure reporting.

```ts
import { Effect } from "effect"
import { assert, describe, it } from "@effect/vitest"

describe("Calculator", () => {
  // Sync test - regular function (rarely needed)
  it("creates instances", () => {
    const result = 1 + 1
    assert.strictEqual(result, 2)
  })

  // Effect test - returns Effect (preferred)
  it.effect("adds numbers", () =>
    Effect.gen(function* () {
      const result = yield* Effect.succeed(1 + 1)
      assert.strictEqual(result, 2)
    })
  )
})
```

## Test Variants

| Function | When to use |
|----------|-------------|
| `it.effect` | **Primary**: Most Effect tests (default) |
| `it.live` | Real clock/tests needing actual delays |
| `it.effect.fails` | Test expected to fail (documents bugs) |
| `it.effect.skip` | Temporarily disable a test |
| `it.effect.only` | Run only this test (focus mode) |
| `it.effect.each(cases)` | Parametrized tests |

### `it.live()` - Real Clock Tests

Use `it.live()` when you need real clock behavior instead of TestClock:

```ts
import { Clock, Effect } from "effect"

// it.effect provides TestContext - clock starts at 0
it.effect("test clock starts at zero", () =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    assert.strictEqual(now, 0)
  })
)

// it.live uses real system clock
it.live("real clock returns actual time", () =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    assert.isAbove(now, 0) // Actual system time
  })
)
```

### Test Modifiers

```ts
// Skip a test temporarily
it.effect.skip("disabled for now", () =>
  Effect.gen(function* () {
    // Won't run
  })
)

// Run only this test (focus mode)
it.effect.only("focus here", () =>
  Effect.gen(function* () {
    // Only this runs
  })
)

// Expect a test to fail (documents known bugs)
it.effect.fails("known bug - should be fixed", () =>
  Effect.gen(function* () {
    assert.strictEqual(1 + 1, 3) // Expected to fail
  })
)
```

## Per-Test Layer Pattern (Preferred)

**Opinionated guidance**: Use `Effect.provide(layer)` per test instead of `it.layer()`. This avoids state leakage between tests and makes each test self-contained.

```ts
import { Effect, Layer, Context } from "effect"

class Database extends Context.Service<
  Database,
  { query: (sql: string) => Effect.Effect<string[]> }
>()("Database") {}

// Layer.succeed is preferred over ConfigProvider.fromMap for tests
const testDatabase = Layer.succeed(Database, {
  query: (_sql) => Effect.succeed(["mock", "data"])
})

it.effect("queries database", () =>
  Effect.gen(function* () {
    const db = yield* Database
    const results = yield* db.query("SELECT * FROM users")
    assert.strictEqual(results.length, 2)
  }).pipe(Effect.provide(testDatabase)) // Per-test provision
)
```

## Layer Patterns for Testing

### `Layer.provideMerge()` - Exposing Leaf Services

Use `Layer.provideMerge()` to compose layers while exposing leaf services for test setup and assertions. This is critical for testing orchestrated services.

```ts
import { Effect, Layer, Context, Clock } from "effect"

// Leaf service
class Users extends Context.Service<Users, { findById: (id: string) => Effect.Effect<string> }>()("Users") {
  static readonly testLayer = Layer.succeed(Users, {
    findById: (_id) => Effect.succeed("Alice")
  })
}

// Orchestrating service
class Events extends Context.Service<Events, { register: (userId: string) => Effect.Effect<string> }>()("Events") {
  static readonly layer = Layer.effect(
    Events,
    Effect.gen(function* () {
      const users = yield* Users
      return {
        register: (userId: string) =>
          Effect.gen(function* () {
            const user = yield* users.findById(userId)
            return `Registered: ${user}`
          })
      }
    })
  )
}

// provideMerge exposes leaf services in tests for setup/assertions
const testLayer = Events.layer.pipe(
  Layer.provideMerge(Users.testLayer)
)

it.effect("registers user", () =>
  Effect.gen(function* () {
    const events = yield* Events
    const users = yield* Users // Accessible thanks to provideMerge

    // Can use users service for setup/assertions
    const result = yield* events.register("user-123")
    assert.strictEqual(result, "Registered: Alice")
  }).pipe(Effect.provide(testLayer))
)
```

### `Layer.succeed()` vs `ConfigProvider.fromMap`

**Opinionated guidance**: Use `Layer.succeed()` for test configuration instead of `ConfigProvider.fromMap`. It's simpler and more explicit.

```ts
// PREFERRED: Layer.succeed for test configuration
const testConfig = Layer.succeed(Database, {
  host: "localhost",
  port: 5432
})

// AVOID: ConfigProvider.fromMap (more complex, unnecessary for tests)
const testConfigVerbose = Layer.setConfigProvider(
  ConfigProvider.fromMap(new Map([["DB_HOST", "localhost"]]))
)
```

## Test Layer Organization

### `static readonly testLayer` Pattern

Define `testLayer` as a static property on service classes using `Layer.sync()` for mutable test state. This is the preferred pattern for testable services.

```ts
import { Effect, Layer, Context, Option } from "effect"

class Users extends Context.Service<
  Users,
  {
    readonly create: (user: { id: string; name: string }) => Effect.Effect<void>
    readonly findById: (id: string) => Effect.Effect<{ id: string; name: string }>
  }
>()("Users") {
  // Mutable state is fine in tests - JS is single-threaded
  static readonly testLayer = Layer.sync(Users, () => {
    const store = new Map<string, { id: string; name: string }>()

    const create = (user: { id: string; name: string }) =>
      Effect.sync(() => void store.set(user.id, user))

    const findById = (id: string) =>
      Effect.gen(function* () {
        const user = Option.fromNullishOr(store.get(id))
        if (Option.isNone(user)) {
          return yield* Effect.fail(new Error(`User ${id} not found`))
        }
        return user.value
      })

    return { create, findById }
  })
}

class Emails extends Context.Service<
  Emails,
  {
    readonly send: (email: { to: string; subject: string }) => Effect.Effect<void>
    readonly sent: Effect.Effect<ReadonlyArray<{ to: string; subject: string }>>
  }
>()("Emails") {
  static readonly testLayer = Layer.sync(Emails, () => {
    const emails: Array<{ to: string; subject: string }> = []

    const send = (email: { to: string; subject: string }) =>
      Effect.sync(() => void emails.push(email))

    const sent = Effect.sync(() => emails)

    return { send, sent }
  })
}
```

## Assertion Helpers

Import assertion utilities from `@effect/vitest/utils`:

```ts
import { assertSuccess, assertFailure, assertTrue, strictEqual } from "@effect/vitest/utils"
import { Effect } from "effect"

it.effect("assertion helpers", () =>
  Effect.gen(function* () {
    // assertSuccess - expect Effect to succeed with specific value
    const result = yield* Effect.succeed("hello")
    assertSuccess(result, "hello")

    // assertFailure - expect Effect to fail with specific error
    const errorResult = yield* Effect.fail(new Error("oops"))
    assertFailure(errorResult, new Error("oops"))

    // assertTrue - assert boolean condition
    const flag = true
    assertTrue(flag)

    // strictEqual - strict equality check
    strictEqual(1 + 1, 2)
  })
)
```

## TestClock for Time-Based Tests

Use `TestClock.adjust()` to simulate time advancement in tests:

```ts
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"

it.effect("simulates time passage", () =>
  Effect.gen(function* () {
    // Fork an effect that delays for 10 seconds
    const fiber = yield* Effect.delay(
      Effect.succeed("done"),
      "10 seconds"
    ).pipe(Effect.forkChild)

    // Advance time by 10 seconds
    yield* TestClock.adjust("10 seconds")

    // Fiber completes immediately after time adjustment
    const result = yield* Fiber.join(fiber)
    assert.strictEqual(result, "done")
  })
)
```

## Scoped Resources

Scoping is automatic in v4. The scope closes automatically when the test ends, triggering cleanup finalizers:

```ts
import { FileSystem } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect } from "effect"

it.effect("temp directory is cleaned up", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    // makeTempDirectoryScoped creates a directory that's deleted when scope closes
    const tempDir = yield* fs.makeTempDirectoryScoped()

    // Use the temp directory
    yield* fs.writeFileString(`${tempDir}/test.txt`, "hello")
    const exists = yield* fs.exists(`${tempDir}/test.txt`)
    assert.isTrue(exists)

    // When test ends, scope closes and tempDir is deleted automatically
  }).pipe(Effect.provide(NodeFileSystem.layer))
)
```

## Logging in Tests

By default, `it.effect` suppresses log output. To enable logging:

```ts
import { Effect, Logger } from "effect"

// Option 1: Provide a logger inline
it.effect("with logging", () =>
  Effect.gen(function* () {
    yield* Effect.log("This will be shown")
  }).pipe(Effect.provide(Logger.pretty))
)

// Option 2: Use it.live (logging enabled by default)
it.live("live with logging", () =>
  Effect.gen(function* () {
    yield* Effect.log("This will be shown")
  })
)
```

## Flaky Test Helper

Retries until the effect succeeds (useful for non-deterministic operations):

```ts
import { flakyTest } from "@effect/vitest"
import { Effect } from "effect"

flakyTest(
  Effect.succeed(Math.random() > 0.5),
  { timeout: 1000 }
)
```

## Complete Worked Example

Here's a complete example showing all patterns together:

```ts
import { Clock, Effect, Layer, Option, Schema, Context } from "effect"
import { assert, describe, it } from "@effect/vitest"
import { assertTrue } from "@effect/vitest/utils"

// Domain types
const UserId = Schema.String.pipe(Schema.brand("UserId"))
type UserId = typeof UserId.Type

class User extends Schema.Class("User")({
  id: UserId,
  name: Schema.String,
}) {}

// Service with test layer
class Users extends Context.Service<
  Users,
  {
    readonly create: (user: User) => Effect.Effect<void>
    readonly findById: (id: UserId) => Effect.Effect<User>
  }
>()("Users") {
  static readonly testLayer = Layer.sync(Users, () => {
    const store = new Map<UserId, User>()

    return {
      create: (user) => Effect.sync(() => void store.set(user.id, user)),
      findById: (id) =>
        Effect.gen(function* () {
          const user = Option.fromNullishOr(store.get(id))
          if (Option.isNone(user)) return yield* Effect.fail(new Error("Not found"))
          return user.value
        })
    }
  })
}

// Orchestrating service
class Greeter extends Context.Service<
  Greeter,
  { readonly greet: (userId: UserId) => Effect.Effect<string> }
>()("Greeter") {
  static readonly layer = Layer.effect(
    Greeter,
    Effect.gen(function* () {
      const users = yield* Users
      return {
        greet: (userId) =>
          Effect.gen(function* () {
            const user = yield* users.findById(userId)
            return `Hello, ${user.name}!`
          })
      }
    })
  )
}

// Compose test layer with provideMerge to expose leaf services
const testLayer = Greeter.layer.pipe(
  Layer.provideMerge(Users.testLayer)
)

describe("Greeter", () => {
  it.effect("greets a user", () =>
    Effect.gen(function* () {
      const users = yield* Users
      const greeter = yield* Greeter

      // Setup via leaf service
      const user = new User({
        id: UserId.make("user-123"),
        name: "Alice"
      })
      yield* users.create(user)

      // Act
      const greeting = yield* greeter.greet(user.id)

      // Assert
      assert.strictEqual(greeting, "Hello, Alice!")
    }).pipe(Effect.provide(testLayer))
  )

  it.effect.fails("fails for unknown user", () =>
    Effect.gen(function* () {
      const greeter = yield* Greeter
      yield* greeter.greet(UserId.make("unknown"))
    }).pipe(Effect.provide(testLayer))
  )
})
```

## Opinionated Guidance Summary

1. **Use `it.effect()` as your primary test helper** - Most tests should use this
2. **Per-test `Effect.provide(layer)`** - Avoid `it.layer()` to prevent state leakage between tests
3. **`Layer.succeed()` over `ConfigProvider.fromMap`** - Simpler and more explicit for test configuration
4. **Use `Layer.provideMerge()`** - Exposes leaf services for setup and assertions in orchestrated service tests
5. **`static readonly testLayer` with `Layer.sync()`** - Define test layers on service classes for mutable test state
6. **Mutable state is fine in tests** - JavaScript is single-threaded; use Maps, arrays, and counters freely in test layers
7. **Add `addEqualityTesters()`** - Required in vitest setup file for proper Effect value comparison

## Notes

- `@effect/vitest` requires `vitest` as a peer dependency
- Keep `vitest`, `@effect/vitest`, and `effect` on the same release line
- Use `Effect.skip` inside `it.effect` for conditional skipping
