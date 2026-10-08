# Context

`Context` holds a collection of services keyed by their `Context.Service` identifiers.

## Basics

**Create** — start with a single service:

```ts
import { Context } from "effect";

const Logger = Context.Service<{ log: (msg: string) => void }>("Logger");

const services = Context.make(Logger, { log: console.log });
```

**Add** — add more services with `.pipe()`:

```ts
const Database = Context.Service<{ query: (sql: string) => unknown[] }>("Database");

const services = Context.make(Logger, { log: console.log }).pipe(
  Context.add(Database, { query: (sql) => [] }),
);
```

**Get** — retrieve a service (unsafe, throws if missing):

```ts
const logger = Context.get(services, Logger);
logger.log("Hello");
```

**Source:** `effect/Context.ts` - see `~/Developer/effect/packages/effect/src/Context.ts`

## Merging Maps

Combine multiple `Context`s with `mergeAll()`:

```ts
const env1 = Context.make(Logger, { log: console.log });
const env2 = Context.make(Database, { query: () => [] });
const env3 = Context.make(Config, { port: 8080 });

const combined = Context.mergeAll(env1, env2, env3);
```

**Source:** `effect/Context.ts` - see `~/Developer/effect/packages/effect/src/Context.ts`

## Optional Access

Use `getOption()` when a service might not exist:

```ts
import { Option } from "effect";

const maybeLogger: Option.Option<{ log: (msg: string) => void }> = Context.getOption(
  services,
  Logger,
);

Option.match(maybeLogger, {
  onSome: (logger) => logger.log("Found!"),
  onNone: () => console.log("No logger available"),
});
```

**Source:** `effect/Context.ts` - see `~/Developer/effect/packages/effect/src/Context.ts`

## Providing Services

In practice, you rarely build `Context` directly. Use `Layer` to construct and provide services to
effects.

**Source:** `effect/Context.ts` - see `~/Developer/effect/packages/effect/src/Context.ts`
