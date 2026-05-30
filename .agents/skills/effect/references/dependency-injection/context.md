# Context

`Context` holds a collection of services keyed by their `Context.Service` identifiers. In v4, service identifiers are created with `Context.Service` instead of v3's `Context.Tag`, `Context.GenericTag`, or `Effect.Tag`.

## Basics

**Create** — start with a single service:

```ts
import { Context } from "effect"

const Logger = Context.Service<{ log: (msg: string) => void }>("Logger")

const services = Context.make(Logger, { log: console.log })
```

**Add** — add more services with `.pipe()`:

```ts
const Database = Context.Service<{ query: (sql: string) => unknown[] }>("Database")

const services = Context.make(Logger, { log: console.log }).pipe(
  Context.add(Database, { query: async (sql) => [] })
)
```

**Get** — retrieve a service (unsafe, throws if missing):

```ts
const logger = Context.get(services, Logger)
logger.log("Hello")
```

**Source:** `effect/Context.ts` - see `~/Developer/effect/packages/effect/src/Context.ts`

## Merging Maps

Combine multiple `Context`s with `mergeAll()`:

```ts
const env1 = Context.make(Logger, { log: console.log })
const env2 = Context.make(Database, { query: async () => [] })
const env3 = Context.make(Config, { port: 8080 })

const combined = Context.mergeAll(env1, env2, env3)
```

**Source:** `effect/Context.ts` - see `~/Developer/effect/packages/effect/src/Context.ts`

## Optional Access

Use `getOption()` when a service might not exist:

```ts
import { Option } from "effect"

const maybeLogger: Option.Option<{ log: (msg: string) => void }> = 
  Context.getOption(services, Logger)

Option.match(maybeLogger, {
  onSome: (logger) => logger.log("Found!"),
  onNone: () => console.log("No logger available")
})
```

**Source:** `effect/Context.ts` - see `~/Developer/effect/packages/effect/src/Context.ts`

## Quick Reference

| v3                          | v4                               |
|-----------------------------|----------------------------------|
| `Context.empty()`           | `Context.empty()`             |
| `Context.make(tag, impl)`   | `Context.make(tag, impl)`     |
| `Context.add(ctx, tag, impl)` | `Context.add(map, tag, impl)` |
| `Context.get(ctx, tag)`     | `Context.get(map, tag)`       |
| `Context.getOption(ctx, tag)` | `Context.getOption(map, tag)` |
| `Context.merge(ctx1, ctx2)` | `Context.merge(map1, map2)`   |
| `Context.mergeAll(ctxs)`    | `Context.mergeAll(...maps)`   |

In practice, you rarely build `Context` directly. Use `Layer` to construct and provide services to effects.

**Source:** `effect/Context.ts` - see `~/Developer/effect/packages/effect/src/Context.ts`
