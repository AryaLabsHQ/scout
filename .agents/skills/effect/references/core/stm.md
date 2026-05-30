# Transactions (v4)

v4 replaces v3's `STM` module with **transactional refs** (`Tx*`) and an `Effect.tx` boundary. There is no `STM.ts` file — transactions are expressed in the `Effect` channel, not a separate one.

**v3 → v4 rename map**

| v3 | v4 |
|----|----|
| `STM` (separate channel) | `Effect.tx` (Effect-channel boundary) |
| `STM.commit` | implicit on transaction body completion |
| `STM.retry` | `Effect.txRetry` |
| `TRef` | `TxRef` |
| `TMap` / `THashMap` | `TxHashMap` |
| `THashSet` | `TxHashSet` |
| `TQueue` | `TxQueue` |
| `TChunk` | `TxChunk` |

v4 also ships new transactional primitives without v3 equivalents: `TxDeferred`, `TxPubSub`, `TxPriorityQueue`, `TxReentrantLock`, `TxSemaphore`, `TxSubscriptionRef`.

## Transactional References (TxRef)

```typescript
import { Effect, TxRef } from "effect"

const program = Effect.gen(function*() {
  const ref = yield* TxRef.make(0)

  const value = yield* TxRef.get(ref)
  yield* TxRef.set(ref, 42)
  yield* TxRef.update(ref, (n) => n + 1)

  // modify: read current, return [returned, new]
  const doubled = yield* TxRef.modify(ref, (n) => [n * 2, n + 1])
})
```

## Atomic Multi-Step Operations (Effect.tx)

Wrap a body with `Effect.tx` to make it atomic. Reads/writes against `Tx*` values inside are tracked; the body retries automatically on conflict.

```typescript
import { Effect, TxRef } from "effect"

const program = Effect.gen(function*() {
  const account1 = yield* TxRef.make(100)
  const account2 = yield* TxRef.make(50)

  yield* Effect.tx(
    Effect.gen(function*() {
      const balance1 = yield* TxRef.get(account1)
      const balance2 = yield* TxRef.get(account2)

      yield* TxRef.set(account1, balance1 - 50)
      yield* TxRef.set(account2, balance2 + 50)
    })
  )
})
```

`Effect.tx` is idempotent under nesting — a nested `Effect.tx` joins the outer transaction's journal instead of creating a new boundary.

## Explicit Retry (Effect.txRetry)

Block the transaction until an accessed `Tx*` value changes:

```typescript
import { Effect, TxRef } from "effect"

const waitUntilPositive = (ref: TxRef.TxRef<number>) =>
  Effect.tx(
    Effect.gen(function*() {
      const n = yield* TxRef.get(ref)
      if (n <= 0) yield* Effect.txRetry
      return n
    })
  )
```

## TxHashMap

```typescript
import { Effect, TxHashMap } from "effect"

const program = Effect.gen(function*() {
  const users = yield* TxHashMap.make(["john", { name: "John" }] as const)

  yield* TxHashMap.set(users, "jane", { name: "Jane" })
  const user = yield* TxHashMap.get(users, "john") // Option<...>
  yield* TxHashMap.remove(users, "john")
  const size = yield* TxHashMap.size(users)
})
```

## TxQueue

```typescript
import { Effect, TxQueue } from "effect"

const program = Effect.gen(function*() {
  const queue = yield* TxQueue.bounded<number>(10)
  // Or: TxQueue.unbounded(), TxQueue.dropping(n), TxQueue.sliding(n)

  yield* TxQueue.offer(queue, 1)
  const item = yield* TxQueue.take(queue)

  const size = yield* TxQueue.size(queue)
  const empty = yield* TxQueue.isEmpty(queue)
})
```

## TxChunk

```typescript
import { Effect, TxChunk } from "effect"

const program = Effect.gen(function*() {
  const chunk = yield* TxChunk.fromIterable([1, 2, 3])

  yield* TxChunk.append(chunk, 4)
  yield* TxChunk.prepend(chunk, 0)

  const values = yield* TxChunk.get(chunk)
  const size = yield* TxChunk.size(chunk)
})
```

## TxHashSet

```typescript
import { Effect, TxHashSet } from "effect"

const program = Effect.gen(function*() {
  const set = yield* TxHashSet.make("a", "b", "c")

  yield* TxHashSet.add(set, "d")
  const hasA = yield* TxHashSet.has(set, "a")
  yield* TxHashSet.remove(set, "b")
  const size = yield* TxHashSet.size(set)
})
```

## See Also

- [Concurrency](./concurrency.md) — fibers and forking
- [Queue](./queue.md) — non-transactional queues for fiber message passing

---

**Source:** `effect/Effect.ts` (`Effect.tx`, `Effect.txRetry`, `Effect.Transaction`) - see `~/Developer/effect/packages/effect/src/Effect.ts` (lines ~13760–13950)
**Source:** `effect/TxRef.ts` - see `~/Developer/effect/packages/effect/src/TxRef.ts`
**Source:** `effect/TxHashMap.ts` - see `~/Developer/effect/packages/effect/src/TxHashMap.ts`
**Source:** `effect/TxHashSet.ts` - see `~/Developer/effect/packages/effect/src/TxHashSet.ts`
**Source:** `effect/TxQueue.ts` - see `~/Developer/effect/packages/effect/src/TxQueue.ts`
**Source:** `effect/TxChunk.ts` - see `~/Developer/effect/packages/effect/src/TxChunk.ts`
**Source:** Other transactional primitives (no v3 equivalents): `effect/TxDeferred.ts`, `effect/TxPubSub.ts`, `effect/TxPriorityQueue.ts`, `effect/TxReentrantLock.ts`, `effect/TxSemaphore.ts`, `effect/TxSubscriptionRef.ts` - see `~/Developer/effect/packages/effect/src/`
