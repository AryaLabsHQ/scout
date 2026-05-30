# Coordination

These modules coordinate when work runs, how fast it runs, and how work moves between producers and consumers.

## Key APIs

| Module | Key APIs | What they are for |
| --- | --- | --- |
| `RateLimiter` | `RateLimiter.makeWithRateLimiter`, `RateLimiter.makeSleep`, `RateLimiter.layer` | Bound start-rate of effects (token-bucket or fixed-window style limits) |
| `PartitionedSemaphore` | `PartitionedSemaphore.makeUnsafe(permits)` | Shared concurrency limit across partition keys with fair permit distribution |
| `Cron` | `Cron.parse`, `Cron.parseUnsafe`, `Cron.match`, `Cron.next`, `Cron.prev` | Parse cron expressions and compute matching run times |

## Concise Snippet

```ts
import { Effect } from "effect"
import { RateLimiter } from "effect/unstable/persistence"

const program = Effect.gen(function*() {
  // Access rate limiter with delay strategy
  const sleep = yield* RateLimiter.makeSleep

  yield* sleep({
    key: "api-request",
    limit: 10,
    window: "1 seconds"
  })

  // Or use the wrapper function pattern
  const withLimiter = yield* RateLimiter.makeWithRateLimiter
  yield* Effect.log("processing").pipe(
    withLimiter({
      key: "job-1",
      limit: 5,
      window: "10 seconds",
      onExceeded: "delay",
      algorithm: "fixed-window"
    })
  )
})
```

## RateLimiter

RateLimiter is a service accessed via dependency injection. You need to provide a `RateLimiterStore` layer.

```ts
import { Effect, Queue } from "effect"
import { RateLimiter, layerStoreMemory } from "effect/unstable/persistence"

const program = Effect.gen(function*() {
  // Access the rate limiter service
  const limiter = yield* RateLimiter

  // Consume tokens for a key
  const result = yield* limiter.consume({
    key: "api",
    limit: 100,
    window: "1 minute",
    tokens: 1
  })

  if (result.delay > Duration.zero) {
    yield* Effect.sleep(result.delay)
  }
}).pipe(
  Effect.provide(layerStoreMemory)
)
```

**Accessor patterns:**
- `RateLimiter.makeWithRateLimiter` - returns a function to wrap effects with rate limiting
- `RateLimiter.makeSleep` - returns a function that sleeps when rate limited

## PartitionedSemaphore

A keyed semaphore with one global permit pool and fair waiting across partitions.

```ts
import { Effect, PartitionedSemaphore } from "effect"

const program = Effect.gen(function*() {
  // makeUnsafe creates the semaphore with a global permit pool
  const semaphore = yield* Effect.sync(() =>
    PartitionedSemaphore.makeUnsafe<string>({ permits: 4 })
  )

  yield* Effect.all(
    [
      semaphore.withPermits("tenant-a", 2)(Effect.sleep("1 seconds")),
      semaphore.withPermits("tenant-b", 2)(Effect.sleep("1 seconds"))
    ],
    { concurrency: "unbounded", discard: true }
  )
})
```

## Cron

Parse cron expressions and compute matching run times.

```ts
import { Cron, Result } from "effect"

// Parse cron expression (6-field format: second minute hour day month weekday)
const parseResult = Cron.parse("0 0 9 * * 1-5") // 9 AM on weekdays

if (Result.isSuccess(parseResult)) {
  const cron = parseResult.value

  // Check if a date matches
  const matches = Cron.match(cron, new Date())

  // Get next/previous run time
  const nextRun = Cron.next(cron)
  const prevRun = Cron.prev(cron)
}

// Unsafe version throws on invalid input
const unsafeCron = Cron.parseUnsafe("0 * * * * *") // Every minute
```

## Queue (for message passing)

Queue is the correct primitive for producer-consumer patterns in v4.

```ts
import { Effect, Queue } from "effect"

const program = Effect.gen(function*() {
  const queue = yield* Queue.bounded<string>(64)

  // Producer
  yield* Queue.offer(queue, "message-1")
  yield* Queue.offer(queue, "message-2")

  // Consumer
  const msg = yield* Queue.take(queue)
  const all = yield* Queue.takeAll(queue)

  // Backpressure works automatically
})
```

## Related Orchestration Modules

- `ExecutionPlan`: step-based fallback/provision plans for effects or streams via `Effect.withExecutionPlan` / `Stream.withExecutionPlan`.
- `Graph`: directed/undirected graph data structures and algorithms for dependency modeling, traversal, and planning.
- `HashRing`: consistent hashing utility for stable sharding and low-churn node assignment.

## Use Cases

- Enforce per-endpoint or per-tenant request budgets.
- Coordinate producers and workers with queue-based message passing.
- Enforce fair shared concurrency across partitions/tenants with one permit pool.
- Calculate next run times for scheduled jobs from cron strings.
- Build resilient multi-step fallback flows (model/provider/region failover) with execution plans.

---

**Source:** `effect/RateLimiter.ts` - see `~/Developer/effect/packages/effect/src/RateLimiter.ts`

**Source:** `effect/PartitionedSemaphore.ts` - see `~/Developer/effect/packages/effect/src/PartitionedSemaphore.ts`

**Source:** `effect/Cron.ts` - see `~/Developer/effect/packages/effect/src/Cron.ts`

**Source:** `effect/Queue.ts` - see `~/Developer/effect/packages/effect/src/Queue.ts`
