# Context.Service

`Context.Service` is v4's replacement for `Context.Tag`, `Context.GenericTag`, and `Effect.Tag`. It defines a typed service identifier.

**Source:** `effect/Context.ts` - see `~/Developer/effect/packages/effect/src/Context.ts`

## Tag Convention

Prefer `@path/ServiceName` format in application and library code. This prefix pattern prevents collisions and makes service origins immediately obvious. Short names are fine in small examples where the service origin is not important.

```ts
// ✅ Good — namespaced with path prefix
class Database extends Context.Service<Database, { ... }>()("@app/Database") {}
class Users extends Context.Service<Users, { ... }>()("@app/Users") {}
class Logger extends Context.Service<Logger, { ... }>()("@infra/Logger") {}

// Avoid in larger apps — plain names can collide
class Database extends Context.Service<Database, { ... }>()("Database") {}
```

## Define Services

Services provide contracts without implementation. The actual behavior comes through Layers.

```ts
import { Context, Effect } from "effect"

class Database extends Context.Service<
  Database,
  {
    readonly query: (sql: string) => Effect.Effect<unknown[]>
    readonly execute: (sql: string) => Effect.Effect<void>
  }
>()("@app/Database") {}

class Logger extends Context.Service<
  Logger,
  {
    readonly log: (message: string) => Effect.Effect<void>
  }
>()("@app/Logger") {}
```

**Service method signatures must have `R = never`.** Dependencies are handled via Layer composition, not through method signatures. This keeps service interfaces clean and ensures all dependency resolution happens at the layer level.

```ts
// ✅ Good — no R (Requirements) in return type
readonly query: (sql: string) => Effect.Effect<unknown[]>

// ❌ Bad — R includes dependencies
readonly query: (sql: string) => Effect.Effect<unknown[], never, Database>
```

## Effect.fn for Service Methods

Prefer `Effect.fn()` for exported service boundary methods where call-site tracing helps observability. In library internals or hot paths, prefer `Effect.fnUntraced`; for local one-off implementation details, plain `Effect.gen` is fine.

```ts
import { Context, Effect, Layer } from "effect"
import { HttpClient } from "effect/unstable/http"

class Users extends Context.Service<
  Users,
  {
    readonly findById: (id: string) => Effect.Effect<User>
    readonly all: () => Effect.Effect<readonly User[]>
  }
>()("@app/Users") {
  static readonly layer = Layer.effect(
    Users,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient

      // Boundary method with useful tracing
      const findById = Effect.fn("Users.findById")(function* (id: string) {
        const response = yield* http.get(`/users/${id}`)
        return yield* response.json
      })

      // Nullary boundary method with tracing
      const all = Effect.fn("Users.all")(function* () {
        const response = yield* http.get("/users")
        return yield* response.json
      })

      return { findById, all }
    })
  )
}
```

## Effect.fn Transformers

Use the second argument to `Effect.fn` for cross-cutting concerns like error handling. This applies transformers to the entire method body.

```ts
import { Context, Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"

class Users extends Context.Service<
  Users,
  {
    readonly findById: (id: string) => Effect.Effect<User, UsersError>
  }
>()("@app/Users") {
  static readonly layer = Layer.effect(
    Users,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient

      const findById = Effect.fn("Users.findById")(
        function* (id: string) {
          const response = yield* http.get(`/users/${id}`)
          // Raw HTTP errors are caught and transformed below
          return yield* HttpClientResponse.schemaBodyJson(User)(response)
        },
        // Transformer applied to the entire function body
        Effect.catchTag("ResponseError", (error) =>
          Effect.fail(
            error.response.status === 404
              ? new UserNotFoundError({ id })
              : new GenericUsersError({ id, error })
          )
        )
      )

      return { findById }
    })
  )
}
```

## Layer Patterns

Layers provide service implementations. Choose the right constructor for your use case:

| Pattern | Use When | Example |
|---------|----------|---------|
| `Layer.succeed` | Simple mocks, no setup needed | `Layer.succeed(Config, { apiKey: "test" })` |
| `Layer.sync` | Mutable state in tests | `Layer.sync(Counter, () => ({ count: 0 }))` |
| `Layer.effect` | Implementation depends on other services, or needs cleanup via `Effect.acquireRelease` | Most production services, including resources |

```ts
// Layer.succeed — static mock implementation
const mockConfigLayer = Layer.succeed(Config, { apiKey: "test-key" })

// Layer.sync — mutable state for tests
const testCounterLayer = Layer.sync(Counter, () => {
  let count = 0
  return {
    get: () => Effect.succeed(count),
    increment: () => Effect.sync(() => void count++),
  }
})

// Layer.effect — depends on other services
const databaseLayer = Layer.effect(
  Database,
  Effect.gen(function* () {
    const config = yield* Config
    return {
      query: (sql) => Effect.tryPromise(() => db.query(sql)),
      execute: (sql) => Effect.tryPromise(() => db.execute(sql)),
    }
  })
)

// Layer.effect + Effect.acquireRelease — resource with cleanup
const connectionPoolLayer = Layer.effect(
  ConnectionPool,
  Effect.acquireRelease(
    Effect.tryPromise(() => createPool(config)),
    (pool) => Effect.tryPromise(() => pool.close())
  )
)
```

## Layer Composition

Compose layers into a single application layer. **Use `Layer.mergeAll` for 3+ layers** instead of nested `Layer.merge` calls.

```ts
import { Effect, Layer, Context } from "effect"

// Individual service layers
class Config extends Context.Service<Config, { readonly apiKey: string }>()("@app/Config") {}
class Logger extends Context.Service<Logger, { readonly info: (msg: string) => Effect.Effect<void> }>()("@app/Logger") {}
class Database extends Context.Service<Database, { readonly query: () => Effect.Effect<void> }>()("@app/Database") {}
class UserService extends Context.Service<UserService, { readonly getUser: () => Effect.Effect<void> }>()("@app/UserService") {}

// For 2 layers
const partialLayer = Layer.merge(loggerLayer, configLayer)

// For 3+ layers — use mergeAll (cleaner)
const baseLayer = Layer.mergeAll(configLayer, loggerLayer, databaseLayer)

// Layer.provide — service depends on another layer
const userServiceLayer = Layer.effect(
  UserService,
  Effect.gen(function* () {
    const db = yield* Database
    return { getUser: () => db.query() }
  })
).pipe(Layer.provide(databaseLayer))

// Layer.provideMerge — combine with additional dependencies
const appLayer = userServiceLayer.pipe(
  Layer.provideMerge(databaseLayer),
  Layer.provideMerge(loggerLayer),
  Layer.provideMerge(configLayer)
)
```

**`provide` vs `provideMerge`:**
- `Layer.provide(dependency)` — declares that this layer needs `dependency` to construct
- `Layer.provideMerge(otherLayer)` — combines two layers, merging their outputs

## Layer Memoization

**⚠️ Critical:** Effect memoizes layers by reference identity. When the same layer instance appears multiple times in your dependency graph, it's constructed only once.

**The rule:** When using parameterized layer constructors, always store the result in a module-level constant before using it in multiple places.

```ts
// ❌ Bad — two separate pool instances (wasted connections)
const badAppLayer = Layer.merge(
  UserRepo.layer.pipe(
    Layer.provide(Postgres.layer({ url: "postgres://localhost/mydb", poolSize: 10 }))
  ),
  OrderRepo.layer.pipe(
    Layer.provide(Postgres.layer({ url: "postgres://localhost/mydb", poolSize: 10 })) // Different reference!
  )
)
// Creates TWO connection pools (20 connections total). Could hit server limits.

// ✅ Good — single shared instance
const postgresLayer = Postgres.layer({ url: "postgres://localhost/mydb", poolSize: 10 })

const goodAppLayer = Layer.merge(
  UserRepo.layer.pipe(Layer.provide(postgresLayer)),
  OrderRepo.layer.pipe(Layer.provide(postgresLayer)) // Same reference — memoized
)
// Single connection pool (10 connections) shared by both repos
```

## Single Provide at Entry Point

**Provide once at the top of your application.** Avoid scattering `Effect.provide` throughout your codebase.

```ts
// Compose all layers into a single app layer
const appLayer = userServiceLayer.pipe(
  Layer.provideMerge(databaseLayer),
  Layer.provideMerge(loggerLayer),
  Layer.provideMerge(configLayer)
)

// Your program uses services freely — no provides here
const program = Effect.gen(function* () {
  const users = yield* UserService
  const logger = yield* Logger
  yield* logger.info("Starting...")
  yield* users.getUser()
})

// ✅ Single provide at the entry point
const main = program.pipe(Effect.provide(appLayer))
Effect.runPromise(main)
```

**Why provide once at the top?**
- Clear dependency graph: all wiring in one place
- Easier testing: swap `appLayer` for `testLayer`
- No hidden dependencies: effects declare what they need via types
- Simpler refactoring: change wiring without touching business logic

## Service-Driven Development

Start by sketching leaf service tags (without implementations). This lets you write real TypeScript for higher-level orchestration services that type-checks even though the leaf services aren't runnable yet.

```ts
// 1. Sketch leaf service contracts
class Users extends Context.Service<Users, { readonly findById: (id: string) => Effect.Effect<User> }>()("@app/Users") {}
class Tickets extends Context.Service<Tickets, { readonly issue: (userId: string) => Effect.Effect<Ticket> }>()("@app/Tickets") {}
class Emails extends Context.Service<Emails, { readonly send: (to: string, body: string) => Effect.Effect<void> }>()("@app/Emails") {}

// 2. Write orchestration that type-checks immediately
class Events extends Context.Service<Events, { readonly register: (userId: string) => Effect.Effect<Registration> }>()("@app/Events") {
  static readonly layer = Layer.effect(
    Events,
    Effect.gen(function* () {
      const users = yield* Users
      const tickets = yield* Tickets
      const emails = yield* Emails

      const register = Effect.fn("Events.register")(function* (userId: string) {
        const user = yield* users.findById(userId)
        const ticket = yield* tickets.issue(userId)
        yield* emails.send(user.email, `Your ticket: ${ticket.code}`)
        return { userId, ticketId: ticket.id }
      })

      return { register }
    })
  )
}
```

Benefits:
- Leaf service contracts are explicit and type-safe
- Higher-level orchestration coordinates multiple services cleanly
- Type-checks immediately — implement leaf services later
- Adding production implementations doesn't change orchestration code

## Access Services

**`yield*`** — preferred for effectful code:

```ts
const program = Effect.gen(function*() {
  const db = yield* Database
  const result = yield* db.query("SELECT * FROM users")
})
```

**`use`** — one-liner that runs a callback with the service:

```ts
const program = Database.use((db) => db.query("SELECT * FROM users"))
```

Prefer `yield*` over `use` in most cases — `yield*` makes service dependencies explicit at the call site.

## Context Reference

`Context.Reference` creates a service with a default value:

```ts
import { Context } from "effect"

const LogLevel = Context.Reference<"info" | "warn" | "error">("LogLevel", {
  defaultValue: () => "info" as const
})
```

## v3 → v4 Quick Reference

The `Context` module name is the same across v3 and v4. The change is that v4 **unifies the three tag-creation paths** (`Context.Tag`, `Context.GenericTag`, `Effect.Tag`) into a single `Context.Service`.

| v3                              | v4                                  |
|---------------------------------|-------------------------------------|
| `Context.GenericTag<T>(id)`     | `Context.Service<T>(id)`            |
| `Context.Tag(id)<S, Shape>()`   | `Context.Service<S, Shape>()(id)`   |
| `Effect.Tag(id)<S, Shape>()`    | `Context.Service<S, Shape>()(id)`   |
| `Context.Reference<I, T>`       | `Context.Reference<T>` (no `I`)     |
| `Context.make/get/add` (same)   | `Context.make/get/add` (same)       |

## Implementation Source

- **Context.Service:** `~/Developer/effect/packages/effect/src/Context.ts`
- **Context.Reference:** `~/Developer/effect/packages/effect/src/Context.ts` (lines 228-254)
