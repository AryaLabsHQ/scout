# Queue

`Queue` provides typed, fiber-safe producer/consumer coordination with backpressure strategies.

## Basic Usage

```typescript
import { Effect, Queue } from "effect"

const program = Effect.gen(function*() {
  const queue = yield* Queue.unbounded<number>()
  yield* Queue.offer(queue, 1)
  yield* Queue.offer(queue, 2)
  const first = yield* Queue.take(queue)
  const second = yield* Queue.take(queue)
  return [first, second] as const
})
```

## Queue Strategies

```typescript
import { Effect, Queue } from "effect"

const bounded = Effect.runSync(Queue.bounded<number>(100))
const dropping = Effect.runSync(Queue.dropping<number>(100))
const sliding = Effect.runSync(Queue.sliding<number>(100))
```

## Key Functions

| Function | Description |
|----------|-------------|
| `Queue.unbounded()` | No capacity limit |
| `Queue.bounded(n)` | Backpressured bounded queue |
| `Queue.dropping(n)` | Drop new values when full |
| `Queue.sliding(n)` | Drop oldest values when full |
| `Queue.offer(queue, value)` | Enqueue one value |
| `Queue.take(queue)` | Dequeue one value (waits if empty) |
| `Queue.takeAll(queue)` | Drain immediately available values |
| `Queue.shutdown(queue)` | Interrupt waiters and close queue |

## Use Cases

- Worker pools
- Event ingestion pipelines
- Backpressure between producers and consumers

**Source:** `effect/Queue.ts` - see `~/Developer/effect/packages/effect/src/Queue.ts`
