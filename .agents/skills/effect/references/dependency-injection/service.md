# Context.Service

## Table of Contents

- [Tag Convention](#tag-convention)
- [Define Services](#define-services)
- [Module Surface](#module-surface)
- [Effect.fn for Service Methods](#effectfn-for-service-methods)
- [Effect.fn Transformers](#effectfn-transformers)
- [Mapping Boundary Errors](#mapping-boundary-errors)
- [Layer Patterns](#layer-patterns)
- [Layer Composition](#layer-composition)
- [Layer Memoization](#layer-memoization)
- [Single Provide at Entry Point](#single-provide-at-entry-point)
- [Service-Driven Development](#service-driven-development)
- [Access Services](#access-services)
- [Context Reference](#context-reference)
- [Implementation Source](#implementation-source)

`Context.Service` defines a typed service identifier.

**Source:** `effect/Context.ts` - see `~/Developer/effect/packages/effect/src/Context.ts`

## Tag Convention

Prefer `@path/ServiceName` format in application and library code. This prefix pattern prevents
collisions and makes service origins immediately obvious. Short names are fine in small examples
where the service origin is not important.

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
import { Context, Effect } from "effect";

class Database extends Context.Service<
  Database,
  {
    readonly query: (sql: string) => Effect.Effect<unknown[]>;
    readonly execute: (sql: string) => Effect.Effect<void>;
  }
>()("@app/Database") {}

class Logger extends Context.Service<
  Logger,
  {
    readonly log: (message: string) => Effect.Effect<void>;
  }
>()("@app/Logger") {}
```

**Service method signatures must have `R = never`.** Dependencies are handled via Layer composition,
not through method signatures. This keeps service interfaces clean and ensures all dependency
resolution happens at the layer level.

```ts
// ✅ Good — no R (Requirements) in return type
readonly query: (sql: string) => Effect.Effect<unknown[]>

// ❌ Bad — R includes dependencies
readonly query: (sql: string) => Effect.Effect<unknown[], never, Database>
```

Deliberate exception: **ambient per-request context** (auth/org context provided once by request
middleware, e.g. `OrganizationContext`) may ride in method `R` — see the RequestContext seam in
[effect-native-architecture.md](../patterns/effect-native-architecture.md). Infrastructure
dependencies still never appear in `R`; hoist them in the layer.

## Module Surface

The recommended house style gives each service its own file with file-local role names and one
canonical ES-module namespace projection. The file _is_ the module: a self-export at the bottom
gives every consumer the same domain-first name without a TypeScript `namespace`, a wrapper object,
or repeated consumer-side aliases. This is a codebase convention, not required by Effect — follow
the existing module style when a codebase already has one.

```ts
// user-repo.ts
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";

export interface Interface {
  readonly findById: (id: UserId) => Effect.Effect<User, NotFound | PersistenceError>;
}

export class Service extends Context.Service<Service, Interface>()("@app/UserRepo") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const findById = Effect.fn("UserRepo.findById")(function* (id: UserId) {
      // ...
    });

    return Service.of({ findById });
  }),
);

export class NotFound extends Schema.TaggedError<NotFound>()("UserRepo.NotFound", {
  id: UserId,
}) {}

export * as UserRepo from "./user-repo";
```

Consumers import the namespace and read the tag off it:

```ts
import { UserRepo } from "./user-repo";

const program = Effect.gen(function* () {
  const repo = yield* UserRepo.Service;
  return yield* repo.findById(id);
});
```

The self-export is deliberate: it keeps the file as the module while giving every consumer the same
domain-first name. Sibling modules import the owning leaf; barrels relay the identity the leaf
established.

```ts
// Sibling module: import the owning leaf directly.
import { UserRepo } from "./user-repo";

// Folder or package barrel: relay the identity established by the leaf.
export { UserRepo } from "./user-repo";
```

Guidance:

- Do not name the tag class after the domain (`UserRepo`) inside `user-repo.ts`; the module
  namespace is the domain name, and the file-local class is just `Service`.
- Single-file modules self-export their canonical namespace at the bottom with
  `export * as UserRepo from "./user-repo"`.
- Sibling modules import that namespace from the owning leaf, not through their own aggregate
  barrel.
- Folder and package barrels relay established leaf identities with
  `export { UserRepo } from "./user-repo"`.
- The specifiers above are extensionless because that is what most consumers resolve (Bun, Vite,
  bundler and node16 `moduleResolution`). Write them the way the consumer resolves them — a NodeNext
  consumer, the Effect repo itself included, needs the `.js` extension. The pattern is the
  self-export, not the extension.
- Keep errors as `Schema.TaggedError` in the same file (see
  [Mapping Boundary Errors](#mapping-boundary-errors)).
- Export only intentional surface; keep local schemas, row codecs, helpers, and implementation
  details unexported.
- Do not introduce TypeScript `namespace` declarations for organization.
- The resulting `UserRepo.UserRepo === UserRepo` self-reference is unusual. Use this pattern only
  where the runtime and toolchain support it; otherwise fall back to a named service class such as
  `class UserRepo extends Context.Service<...>()(...)` with named exports or a separate barrel.

## Effect.fn for Service Methods

House rule: every public service method and every non-trivial internal method is built with
`Effect.fn("Domain.operation")`. The span name doubles as a call-site label in traces and stack
metadata. Reach for `Effect.fnUntraced` only where dropping that span and stack metadata is a
deliberate choice — hot paths, or wrappers where the trace is pure noise; plain `Effect.gen` is fine
for trivial local one-off helpers.

Service method signatures must still have `R = never` (see above) — `Effect.fn` does not change
that.

```ts
// users.ts
import { Context, Effect, Layer } from "effect";
import { HttpClient } from "effect/http";

export class Users extends Context.Service<
  Users,
  {
    readonly findById: (id: string) => Effect.Effect<User>;
    readonly all: () => Effect.Effect<readonly User[]>;
  }
>()("@app/Users") {}

export const layer = Layer.effect(
  Users,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;

    // Boundary method with useful tracing
    const findById = Effect.fn("Users.findById")(function* (id: string) {
      const response = yield* http.get(`/users/${id}`);
      return yield* response.json;
    });

    // Nullary boundary method with tracing
    const all = Effect.fn("Users.all")(function* () {
      const response = yield* http.get("/users");
      return yield* response.json;
    });

    return Users.of({ findById, all });
  }),
);
```

This example keeps the named-class fallback shape (class `Users`, module-level `layer`) for a
self-contained snippet; in the full [module surface](#module-surface) the class is `Service` and the
file self-exports its `UserRepo`-style namespace.

## Effect.fn Transformers

Pass extra arguments to `Effect.fn` for wrappers that apply to the _whole_ function call. Each
transform receives `(effect, ...originalArgs)`, so it can use the original arguments when
classifying errors, annotating, or provisioning.

```ts
import { Context, Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

export class Users extends Context.Service<
  Users,
  {
    readonly findById: (id: string) => Effect.Effect<User, UsersError>;
  }
>()("@app/Users") {}

export const layer = Layer.effect(
  Users,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;

    const findById = Effect.fn("Users.findById")(
      function* (id: string) {
        const response = yield* http.get(`/users/${id}`);
        // Raw HTTP errors are caught and transformed below
        return yield* HttpClientResponse.schemaBodyJson(User)(response);
      },
      // Transform applied to the entire call, with the original `id` in scope.
      (effect, id) =>
        effect.pipe(
          Effect.catchTag("ResponseError", (error) =>
            Effect.fail(
              error.response.status === 404
                ? new UserNotFoundError({ id })
                : new GenericUsersError({ id, error }),
            ),
          ),
        ),
    );

    return Users.of({ findById });
  }),
);
```

Good transforms are whole-call concerns: error classification, localized recovery, log annotations,
spans, retry, timeout, ensuring cleanup, and small local provisioning.

Guidance:

- Keep the generator body focused on the core workflow.
- One or two transforms is usually enough; do not build long clever pipelines.
- Do not use transforms for local, branch-level handling inside the workflow — handle that inline
  where it happens.

## Mapping Boundary Errors

Map an infrastructure failure to a tagged error that carries its `cause` and any domain data, inline
at the call. The `Effect.fn` span name records which operation failed, so the error needs no
`operation` label and no curried helper to bind one.

```ts
const findById = Effect.fn("UserRepo.findById")(function* (id: UserId) {
  return yield* sql`SELECT * FROM users WHERE id = ${id}`.pipe(
    Effect.mapError((cause) => new PersistenceError({ cause })),
  );
});
```

## Layer Patterns

Layers provide service implementations. Choose the right constructor for your use case:

| Pattern         | Use When                                                                               | Example                                       |
| --------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| `Layer.succeed` | Simple mocks, no setup needed                                                          | `Layer.succeed(Config, { apiKey: "test" })`   |
| `Layer.sync`    | Mutable state in tests                                                                 | `Layer.sync(Counter, () => ({ count: 0 }))`   |
| `Layer.effect`  | Implementation depends on other services, or needs cleanup via `Effect.acquireRelease` | Most production services, including resources |

```ts
// Layer.succeed — static mock implementation
const mockConfigLayer = Layer.succeed(Config, { apiKey: "test-key" });

// Layer.sync — mutable state for tests
const testCounterLayer = Layer.sync(Counter, () => {
  let count = 0;
  return {
    get: () => Effect.succeed(count),
    increment: () => Effect.sync(() => void count++),
  };
});

// Layer.effect — depends on other services
const databaseLayer = Layer.effect(
  Database,
  Effect.gen(function* () {
    const config = yield* Config;
    return {
      query: (sql) => Effect.tryPromise(() => db.query(sql)),
      execute: (sql) => Effect.tryPromise(() => db.execute(sql)),
    };
  }),
);

// Layer.effect + Effect.acquireRelease — resource with cleanup
const connectionPoolLayer = Layer.effect(
  ConnectionPool,
  Effect.acquireRelease(
    Effect.tryPromise(() => createPool(config)),
    (pool) => Effect.tryPromise(() => pool.close()),
  ),
);
```

## Layer Composition

Compose layers into a single application layer. **Use `Layer.mergeAll` for 3+ layers** instead of
nested `Layer.merge` calls.

```ts
import { Effect, Layer, Context } from "effect";

// Individual service layers
class Config extends Context.Service<Config, { readonly apiKey: string }>()("@app/Config") {}
class Logger extends Context.Service<
  Logger,
  { readonly info: (msg: string) => Effect.Effect<void> }
>()("@app/Logger") {}
class Database extends Context.Service<Database, { readonly query: () => Effect.Effect<void> }>()(
  "@app/Database",
) {}
class UserService extends Context.Service<
  UserService,
  { readonly getUser: () => Effect.Effect<void> }
>()("@app/UserService") {}

// For 2 layers
const partialLayer = Layer.merge(loggerLayer, configLayer);

// For 3+ layers — use mergeAll (cleaner)
const baseLayer = Layer.mergeAll(configLayer, loggerLayer, databaseLayer);

// Layer.provide — service depends on another layer
const userServiceLayer = Layer.effect(
  UserService,
  Effect.gen(function* () {
    const db = yield* Database;
    return UserService.of({ getUser: () => db.query() });
  }),
).pipe(Layer.provide(databaseLayer));

// Layer.provideMerge — combine with additional dependencies
const appLayer = userServiceLayer.pipe(
  Layer.provideMerge(databaseLayer),
  Layer.provideMerge(loggerLayer),
  Layer.provideMerge(configLayer),
);
```

**`provide` vs `provideMerge`:**

- `Layer.provide(dependency)` — declares that this layer needs `dependency` to construct
- `Layer.provideMerge(otherLayer)` — combines two layers, merging their outputs

## Layer Memoization

**⚠️ Critical:** Effect memoizes layers by reference identity. When the same layer instance appears
multiple times in your dependency graph, it's constructed only once.

**The rule:** When using parameterized layer constructors, always store the result in a module-level
constant before using it in multiple places.

```ts
// ❌ Bad — two separate pool instances (wasted connections)
const badAppLayer = Layer.merge(
  UserRepo.layer.pipe(
    Layer.provide(Postgres.layer({ url: "postgres://localhost/mydb", poolSize: 10 })),
  ),
  OrderRepo.layer.pipe(
    Layer.provide(Postgres.layer({ url: "postgres://localhost/mydb", poolSize: 10 })), // Different reference!
  ),
);
// Creates TWO connection pools (20 connections total). Could hit server limits.

// ✅ Good — single shared instance
const postgresLayer = Postgres.layer({ url: "postgres://localhost/mydb", poolSize: 10 });

const goodAppLayer = Layer.merge(
  UserRepo.layer.pipe(Layer.provide(postgresLayer)),
  OrderRepo.layer.pipe(Layer.provide(postgresLayer)), // Same reference — memoized
);
// Single connection pool (10 connections) shared by both repos
```

## Single Provide at Entry Point

**Provide once at the top of your application.** Avoid scattering `Effect.provide` throughout your
codebase.

```ts
// Compose all layers into a single app layer
const appLayer = userServiceLayer.pipe(
  Layer.provideMerge(databaseLayer),
  Layer.provideMerge(loggerLayer),
  Layer.provideMerge(configLayer),
);

// Your program uses services freely — no provides here
const program = Effect.gen(function* () {
  const users = yield* UserService;
  const logger = yield* Logger;
  yield* logger.info("Starting...");
  yield* users.getUser();
});

// ✅ Single provide at the entry point
const main = program.pipe(Effect.provide(appLayer));
Effect.runPromise(main);
```

**Why provide once at the top?**

- Clear dependency graph: all wiring in one place
- Easier testing: swap `appLayer` for `testLayer`
- No hidden dependencies: effects declare what they need via types
- Simpler refactoring: change wiring without touching business logic

## Service-Driven Development

Start by sketching leaf service tags (without implementations). This lets you write real TypeScript
for higher-level orchestration services that type-checks even though the leaf services aren't
runnable yet.

```ts
// 1. Sketch leaf service contracts
class Users extends Context.Service<
  Users,
  { readonly findById: (id: string) => Effect.Effect<User> }
>()("@app/Users") {}
class Tickets extends Context.Service<
  Tickets,
  { readonly issue: (userId: string) => Effect.Effect<Ticket> }
>()("@app/Tickets") {}
class Emails extends Context.Service<
  Emails,
  { readonly send: (to: string, body: string) => Effect.Effect<void> }
>()("@app/Emails") {}

// 2. Write orchestration that type-checks immediately
class Events extends Context.Service<
  Events,
  { readonly register: (userId: string) => Effect.Effect<Registration> }
>()("@app/Events") {}

const layer = Layer.effect(
  Events,
  Effect.gen(function* () {
    const users = yield* Users;
    const tickets = yield* Tickets;
    const emails = yield* Emails;

    const register = Effect.fn("Events.register")(function* (userId: string) {
      const user = yield* users.findById(userId);
      const ticket = yield* tickets.issue(userId);
      yield* emails.send(user.email, `Your ticket: ${ticket.code}`);
      return { userId, ticketId: ticket.id };
    });

    return Events.of({ register });
  }),
);
```

Benefits:

- Leaf service contracts are explicit and type-safe
- Higher-level orchestration coordinates multiple services cleanly
- Type-checks immediately — implement leaf services later
- Adding production implementations doesn't change orchestration code

## Access Services

**`yield*`** — preferred for effectful code:

```ts
const program = Effect.gen(function* () {
  const db = yield* Database;
  const result = yield* db.query("SELECT * FROM users");
});
```

**`use`** — one-liner that runs a callback with the service:

```ts
const program = Database.use((db) => db.query("SELECT * FROM users"));
```

Prefer `yield*` over `use` in most cases — `yield*` makes service dependencies explicit at the call
site.

## Context Reference

`Context.Reference` creates a service with a default value:

```ts
import { Context } from "effect";

const LogLevel = Context.Reference<"info" | "warn" | "error">("LogLevel", {
  defaultValue: () => "info" as const,
});
```

## Implementation Source

- **Context.Service:** `~/Developer/effect/packages/effect/src/Context.ts`
- **Context.Reference:** `~/Developer/effect/packages/effect/src/Context.ts` (lines 228-254)
