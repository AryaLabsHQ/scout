# Cache

## Table of Contents

- [Create Cache](#create-cache)
- [Use Cache](#use-cache)
- [Core Rules](#core-rules)
- [Exit-Aware TTL (cache successes, skip degraded results)](#exit-aware-ttl-cache-successes-skip-degraded-results)
- [Expensive Client Acquisition Belongs In The Layer, Not The Lookup](#expensive-client-acquisition-belongs-in-the-layer-not-the-lookup)
- [Choosing: Cache vs Request Batching vs Concurrency](#choosing-cache-vs-request-batching-vs-concurrency)
- [Do Nots](#do-nots)

**Source:** `effect/Cache.ts` - see

`~/Developer/effect/packages/effect/src/Cache.ts`

Prefer `effect/Cache` over a hand-rolled `Map` + timestamp + prune-loop cache whenever its keyed
memoization, TTL, capacity, lifecycle, and eviction semantics fit. `Cache.make` requires `capacity`,
`timeToLive`, and `lookup`.

## Create Cache

```ts
import { Cache, Effect } from "effect";

const makeCache = Cache.make<string, number>({
  capacity: 100,
  timeToLive: "1 minute",
  lookup: (key) => Effect.succeed(key.length),
});
```

## Use Cache

```ts
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const cache = yield* makeCache;

  const value = yield* Cache.get(cache, "hello");
  const maybe = yield* Cache.getOption(cache, "hello");

  yield* Cache.refresh(cache, "hello");
  yield* Cache.invalidate(cache, "hello");

  const size = yield* Cache.size(cache);

  return { value, maybe, size };
});
```

`Cache.size(cache)` returns `Effect<number>`.

## Core Rules

- `Cache.make({ capacity, lookup, timeToLive })` caches per-key lookups with one fixed TTL for all
  entries.
- `Cache.makeWith(lookup, { capacity, timeToLive(exit, key) })` computes TTL per entry from the
  lookup's `Exit` — the tool for "cache successes, not failures".
- Concurrent `Cache.get` calls for the same missing key share one pending lookup — dedupe is built
  in; do not add your own in-flight tracking.
- `capacity` is required and bounds the cache; stop writing manual prune/evict loops.
- Return a zero TTL (`Duration.zero`) from `timeToLive` to skip caching transient failures or
  degraded fallbacks without failing the caller. A short negative-cache TTL can be appropriate for
  stable failures such as not-found results.
- `Cache.invalidate(cache, key)` / `Cache.refresh(cache, key)` handle explicit staleness;
  `Cache.has(cache, key)` checks membership without triggering a lookup.
- Cache construction is effectful. Build the cache once in the owning layer/scope and share the
  handle; a cache built per call caches nothing.
- For a single value (no key), use `Effect.cached(effect)` or `Effect.cachedWithTTL(effect, ttl)`
  instead of a one-key Cache. Since rc.114 `cachedWithTTL` may compute the TTL from each completed
  `Exit`, so successes and failures can cache for different durations.
- For cached resources that need cleanup (connections, clients), use `ScopedCache`.

## Exit-Aware TTL (cache successes, skip degraded results)

`Cache.makeWith` receives the lookup's `Exit`, so the TTL can depend on the outcome — cache good
results, skip degraded ones:

```ts
import { Cache, Duration, Effect, Exit } from "effect";

const makeResolver = Effect.gen(function* () {
  const cache = yield* Cache.makeWith(
    // never-failing lookup, returns { where, cacheable }
    (channelRef: string) => resolveUncached(channelRef),
    {
      capacity: 300,
      timeToLive: (exit) =>
        Exit.isSuccess(exit) && exit.value.cacheable ? "10 minutes" : Duration.zero,
    },
  );

  return (channelRef: string) =>
    Cache.get(cache, channelRef).pipe(Effect.map((resolved) => resolved.where));
});
```

This replaces a hand-rolled `Map<string, { value, expiresAtMs }>` plus prune logic, and upgrades it:
repeated rows pointing at the same key during one burst share a single provider call.

## Expensive Client Acquisition Belongs In The Layer, Not The Lookup

A cache cannot fix a lookup that pays a scoped acquisition per call, such as SDK client construction
or authentication. Acquire clients once via the owning layer so the cached lookup is a plain call:

```ts
// Bad: every cache miss acquires a fresh client
const lookup = (id: string) => getRecord(id).pipe(Effect.provide(apiClientLayer(options)));

// Good: client built once for the layer's lifetime; misses are one API call.
// Layer.build requires Scope.Scope — acquire this inside the owning layer's scope.
const context = yield * Layer.build(apiClientLayer(options));
const lookup = (id: string) => Context.get(context, ApiClient).getRecord(id);
```

## Choosing: Cache vs Request Batching vs Concurrency

Batching (`Effect.request` + `RequestResolver`) exists for backends with a **real batch endpoint**:
the resolver receives an array of pending requests and collapses them into one wire call (SQL
`IN (...)`, DataLoader-style endpoints, batch GET). `RequestResolver.batchN(resolver, n)` bounds
batch size; `RequestResolver.makeGrouped` groups requests that must resolve through different
targets. See [request.md](./request.md).

Do not reach for batching when the backend only has per-item endpoints (most REST provider APIs): a
batched resolver still loops one call per entry, so it buys nothing over
`Effect.forEach(items, f, { concurrency })` plus a `Cache` for dedupe/memoization.

Selection guide:

- Same key requested repeatedly over time → `Cache`.
- Same key requested concurrently in one burst → `Cache` (shared pending lookup).
- Many distinct keys, backend has a batch endpoint → `Effect.request` + `RequestResolver`.
- Many distinct keys, per-item endpoint only → `Effect.forEach(..., { concurrency: n })`, optionally
  through a `Cache`.

## Do Nots

- Do not hand-roll Map/TTL/prune caches, in-flight dedupe maps, or LRU logic when `Cache` fits.
- Do not build a cache inside a request handler or per call — hoist it to the owning layer.
- Do not adopt `RequestResolver` batching for per-item REST endpoints just because "batching" sounds
  faster.
- Do not put scoped client acquisition inside the cache lookup; acquire once in the layer.
- Choose failure TTLs by semantics: skip transient failures and degraded fallbacks by default;
  bounded negative caching can protect an upstream from repeated stable failures.
