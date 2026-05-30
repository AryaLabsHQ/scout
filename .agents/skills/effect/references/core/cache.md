# Cache

**Source:** `effect/Cache.ts` - see `~/Developer/effect/packages/effect/src/Cache.ts`

`Cache.make` requires `capacity`, `timeToLive`, and `lookup`.

## Create Cache

```ts
import { Cache, Effect } from "effect"

const makeCache = Cache.make<string, number>({
  capacity: 100,
  timeToLive: "1 minute",
  lookup: (key) => Effect.succeed(key.length)
})
```

## Use Cache

```ts
import { Effect } from "effect"

const program = Effect.gen(function*() {
  const cache = yield* makeCache

  const value = yield* Cache.get(cache, "hello")
  const maybe = yield* Cache.getOption(cache, "hello")

  yield* Cache.refresh(cache, "hello")
  yield* Cache.invalidate(cache, "hello")

  const size = yield* Cache.size(cache)

  return { value, maybe, size }
})
```

`Cache.size(cache)` returns `Effect<number>`.
