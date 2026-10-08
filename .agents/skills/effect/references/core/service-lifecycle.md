# Service Lifecycle

## Table of Contents

- [Key APIs](#key-apis)
- [Resource Safety](#resource-safety)
- [Concise Snippet](#concise-snippet)
- [Service Definitions](#service-definitions)
- [Layer Memoization](#layer-memoization)
- [Usage Intent: `Redacted`](#usage-intent-redacted)
- [Use Cases](#use-cases)

Use these modules when service instances need controlled refresh, scoped

replacement, or key-based dynamic provisioning over time.

## Key APIs

| Module      | Key APIs                                                                             | What they are for                                                               |
| ----------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `Pool`      | `Pool.make`, `Pool.get`, `Pool.use`, `Pool.invalidate`                               | Bounded resource pool. `Pool.get` needs a `Scope`; `Pool.use(pool, f)` does not |
| `ScopedRef` | `ScopedRef.fromAcquire`, `ScopedRef.make`, `ScopedRef.get`, `ScopedRef.set`          | Atomically replace resourceful values and release old resources safely          |
| `LayerMap`  | `LayerMap.make`, `LayerMap.Service`, `map.get`, `map.runtime`, `map.invalidate`      | Dynamically materialize and cache layers by key (tenant/region/model/etc.)      |
| `Redacted`  | `Redacted.make`, `Redacted.value`, `Redacted.wipeUnsafe`, `Redacted.makeEquivalence` | Hold sensitive values while preventing accidental display in logs/debug output  |

## Resource Safety

```
Resource safety?
├─ Acquire/release resource → Effect.acquireRelease(acquire, release)
├─ Acquire/use/release in one block → Effect.acquireUseRelease(acquire, use, release)
├─ Run workflow in a managed scope → effect.pipe(Effect.scoped)
└─ Provide scoped service dependency → Layer.effect(Tag, Effect.acquireRelease(acquire, release))
```

A service whose construction acquires something releasable belongs in
`Layer.effect(Service, Effect.acquireRelease(...))`, so the layer's scope — not the caller — owns
the release. Use `Effect.scoped` only where a workflow, rather than a service, owns the resource's
lifetime.

`Pool.get` leases an item until the current scope closes. `Pool.use(pool, item => ...)` borrows for
the callback and returns the item without requiring a `Scope`. Build the pool once in the owning
layer. Do not hand-roll a Map of connections.

## Concise Snippet

```ts
import { Effect, Layer, ScopedRef, Context } from "effect";

class Client extends Context.Service<
  Client,
  {
    readonly query: (q: string) => Effect.Effect<string>;
  }
>()("Client") {}

const ClientLive = Layer.succeed(Client, {
  query: (q: string) => Effect.succeed(`ok:${q}`),
});

const program = Effect.scoped(
  Effect.gen(function* () {
    const configRef = yield* ScopedRef.fromAcquire(
      Effect.succeed({ baseUrl: "https://api-a.example.com" }),
    );

    const client = yield* Client;
    yield* client.query("health");

    yield* ScopedRef.set(configRef, Effect.succeed({ baseUrl: "https://api-b.example.com" }));

    return yield* ScopedRef.get(configRef);
  }),
).pipe(Effect.provide(ClientLive));
```

## Service Definitions

Define services with `Context.Service`:

```ts
class Config extends Context.Service<Config, { readonly port: number }>()("Config") {}
```

## Layer Memoization

Layers are memoized across `Effect.provide` calls automatically (via a shared `MemoMap`). Use
`Effect.provide(layer, { local: true })` for local-only memoization, or `Layer.fresh` to bypass
memoization.

## Usage Intent: `Redacted`

- Use `Redacted` for values that must not appear in normal logs/inspection output.
- Unwrap with `Redacted.value` only at the boundary where plaintext is truly needed.
- Wipe in-memory values with `Redacted.wipeUnsafe` when lifecycle policy requires explicit cleanup.

## Use Cases

- Hot-reload API clients or config-backed services without process restarts.
- Swap credentials/endpoints while ensuring prior resources are released.
- Lazily provision per-tenant/per-region dependencies from keyed layers.
- Protect tokens/keys in diagnostics while still allowing explicit boundary unwrap.

---

**Source:** `effect/Pool.ts` - see `~/Developer/effect/packages/effect/src/Pool.ts`

**Source:** `effect/ScopedRef.ts` - see `~/Developer/effect/packages/effect/src/ScopedRef.ts`

**Source:** `effect/LayerMap.ts` - see `~/Developer/effect/packages/effect/src/LayerMap.ts`

**Source:** `effect/Redacted.ts` - see `~/Developer/effect/packages/effect/src/Redacted.ts`
