# Stream

`Stream<A, E, R>` models pull-based effectful streams. v4 Stream is built on `Channel`.

## Constructors

```ts
import { Effect, Stream } from "effect"

const s1 = Stream.fromIterable([1, 2, 3])
const s2 = Stream.fromIterableEffect(Effect.succeed([1, 2, 3]))
const s3 = Stream.make(1, 2, 3)
```

## Transform

```ts
const transformed = Stream.fromIterable([1, 2, 3]).pipe(
  Stream.map((n) => n + 1),
  Stream.flatMap((n) => Stream.fromIterable([n, n * 10])),
  Stream.take(4)
)
```

`Stream.flatMap` supports `concurrency` and `bufferSize` options.

## Run

```ts
import { Effect, Stream } from "effect"

// Collect all values into an array
const collected = Stream.runCollect(Stream.fromIterable([1, 2, 3]))

// Run each element through a function
const program = Stream.fromIterable([1, 2, 3]).pipe(
  Stream.runForEach((n) => Console.log(n))
)

// Drain the stream (ignore output)
const drained = Stream.runDrain(Stream.fromIterable([1, 2, 3]))

// Run with a Sink
import * as Sink from "effect/Sink"
const withSink = Stream.run(Stream.fromIterable([1, 2, 3]), Sink.head())
```

`Stream.runCollect` returns `Effect<Array<A>, E, R>` (not Chunk in v4).

**Source:** `effect/Stream.ts` - see `~/Developer/effect/packages/effect/src/Stream.ts`
