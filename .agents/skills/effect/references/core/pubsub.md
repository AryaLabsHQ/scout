# PubSub - Publish/Subscribe

`PubSub` provides a publish-subscribe pattern for communicating between fibers.

## Basic Usage

```typescript
import { Effect, PubSub, Queue } from "effect"

const program = Effect.scoped(
  Effect.gen(function*() {
    const pubsub = yield* PubSub.bounded<string>(10)
    yield* PubSub.publish(pubsub, "hello")
    yield* PubSub.publish(pubsub, "world")

    // Subscribe requires Scope
    const dequeue = yield* PubSub.subscribe(pubsub)
    const msg1 = yield* Queue.take(dequeue)
    const msg2 = yield* Queue.take(dequeue)
    return [msg1, msg2] as const
  })
)

const [msg1, msg2] = Effect.runSync(program)
```

## Buffered PubSub

```typescript
import { Effect, PubSub } from "effect"

// Bounded - blocks when full
const bounded = Effect.runSync(PubSub.bounded<string>(10))

// Unbounded - never blocks
const unbounded = Effect.runSync(PubSub.unbounded<string>())
```

## Key Functions

| Function | Description |
|----------|-------------|
| `PubSub.bounded(capacity)` | Bounded pubsub |
| `PubSub.unbounded()` | Unbounded pubsub |
| `PubSub.publish(pubsub, value)` | Publish message |
| `PubSub.subscribe(pubsub)` | Subscribe in scope (returns Dequeue) |

## Use Cases

- Event-driven communication
- Message queues
- Fan-out patterns

## See Also

- [Stream](../streaming/stream.md) - Stream processing
- [Concurrency](./concurrency.md) - Fibers

**Source:** `effect/PubSub.ts` - see `~/Developer/effect/packages/effect/src/PubSub.ts`
**Source:** `effect/Queue.ts` - see `~/Developer/effect/packages/effect/src/Queue.ts`
