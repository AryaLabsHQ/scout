# Service Lifecycle

Use these modules when service instances need controlled refresh, scoped replacement, or key-based dynamic provisioning over time.

## Key APIs

| Module | Key APIs | What they are for |
| --- | --- | --- |
| `Reloadable` | — | Removed in v4 — use `LayerMap` for keyed service provisioning or `ScopedRef` for mutable cell pattern |
| `ScopedRef` | `ScopedRef.fromAcquire`, `ScopedRef.make`, `ScopedRef.get`, `ScopedRef.set` | Atomically replace resourceful values and release old resources safely |
| `LayerMap` | `LayerMap.make`, `LayerMap.Service`, `map.get`, `map.runtime`, `map.invalidate` | Dynamically materialize and cache layers by key (tenant/region/model/etc.) |
| `Redacted` | `Redacted.make`, `Redacted.value`, `Redacted.wipeUnsafe`, `Redacted.makeEquivalence` | Hold sensitive values while preventing accidental display in logs/debug output |
| `Secret` | `Secret.fromString`, `Secret.value`, `Secret.unsafeWipe` | Legacy sensitive wrapper (`Secret` is deprecated; prefer `Redacted`) |

## Concise Snippet

```ts
import { Effect, Layer, ScopedRef, Context } from "effect"

class Client extends Context.Service<Client, {
  readonly query: (q: string) => Effect.Effect<string>
}>()("Client") {}

const ClientLive = Layer.succeed(Client, {
  query: (q: string) => Effect.succeed(`ok:${q}`)
})

const program = Effect.scoped(
  Effect.gen(function*() {
    const configRef = yield* ScopedRef.fromAcquire(
      Effect.succeed({ baseUrl: "https://api-a.example.com" })
    )

    const client = yield* Client
    yield* client.query("health")

    yield* ScopedRef.set(
      configRef,
      Effect.succeed({ baseUrl: "https://api-b.example.com" })
    )

    return yield* ScopedRef.get(configRef)
  })
).pipe(Effect.provide(ClientLive))
```

## v4: Context.Service Instead of Context.Tag

In v4, services use `Context.Service` instead of `Context.Tag`:

```ts
// v4
class Config extends Context.Service<Config, { readonly port: number }>()("Config") {}
```

## v4 Layer Memoization

In v4, layers are memoized across `Effect.provide` calls automatically (via a shared `MemoMap`). Use `Effect.provide(layer, { local: true })` for local-only memoization, or `Layer.fresh` to bypass memoization.

## Usage Intent: `Secret` / `Redacted`

- Use `Redacted` for values that must not appear in normal logs/inspection output.
- Unwrap with `Redacted.value` only at the boundary where plaintext is truly needed.
- Wipe in-memory values with `Redacted.wipeUnsafe` when lifecycle policy requires explicit cleanup.
- Keep `Secret` only for interop with older code paths; new code should migrate to `Redacted`.

## Use Cases

- Hot-reload API clients or config-backed services without process restarts.
- Swap credentials/endpoints while ensuring prior resources are released.
- Lazily provision per-tenant/per-region dependencies from keyed layers.
- Protect tokens/keys in diagnostics while still allowing explicit boundary unwrap.

---

**Source:** `effect/ScopedRef.ts` - see `~/Developer/effect/packages/effect/src/ScopedRef.ts`

**Source:** `effect/LayerMap.ts` - see `~/Developer/effect/packages/effect/src/LayerMap.ts`

**Source:** `effect/Redacted.ts` - see `~/Developer/effect/packages/effect/src/Redacted.ts`

**Source:** `effect/Secret.ts` - see `~/Developer/effect/packages/effect/src/Secret.ts`
