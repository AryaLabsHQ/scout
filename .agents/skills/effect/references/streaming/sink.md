# Sink

`Sink<A, In, L, E, R>` consumes stream inputs and produces a summary value of type `A`, with leftover inputs of type `L`.

## Common Sinks

```ts
import * as Sink from "effect/Sink"
import * as Option from "effect/Option"

const collect = Sink.collect<number>()
const sum = Sink.sum
const count = Sink.count
const head = Sink.head<number>()       // => Sink<Option.Option<In>, In, In>
const last = Sink.last<number>()      // => Sink<Option.Option<In>, In>
const find = Sink.find((n: number) => n > 5)
```

## Collecting

```ts
// Collect all inputs into an array
const collect = Sink.collect<number>()

// Take exactly n inputs
const take5 = Sink.take<number>(5)

// Take while predicate is true
const takeWhilePositive = Sink.takeWhile((n: number) => n > 0)
```

## Folding

```ts
// Reduce with a predicate for when to stop
const fold = Sink.fold(
  () => 0,              // initial state
  (s: number) => s < 100,  // continue while true
  (s: number, n: number) => s + n
)

// Fold until max items
const foldUntil = Sink.foldUntil(
  () => 0,
  100,
  (s: number, n: number) => s + n
)

// Reduce all inputs
const reduce = Sink.reduce(
  () => 0,
  (s: number, n: number) => s + n
)
```

## Run a Stream with a Sink

```ts
import { Effect, Stream } from "effect"
import * as Sink from "effect/Sink"

const result = Effect.runPromise(
  Stream.run(Stream.fromIterable([1, 2, 3]), Sink.head())
)
// result: Option.Option<number>
```

**Source:** `effect/Sink.ts` - see `~/Developer/effect/packages/effect/src/Sink.ts`
