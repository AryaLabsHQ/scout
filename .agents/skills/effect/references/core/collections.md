# Collections

## Table of Contents

- [Channel](#channel)
- [Chunk](#chunk)
- [DateTime](#datetime)
- [HashMap](#hashmap)
- [HashSet](#hashset)
- [Match](#match)

This page covers common Effect collection and matching modules you will use with

streams, state, and branching logic:

- `Channel`
- `Chunk`
- `DateTime`
- `HashMap`
- `HashSet`
- `Match`

## Channel

`Channel` is the low-level streaming primitive behind `Stream` and `Sink`. Use it when you need
custom read/write composition that is more specialized than standard stream operators.

### Key APIs

| API                                          | Purpose                                        |
| -------------------------------------------- | ---------------------------------------------- |
| `Channel.write`                              | Emit an output element                         |
| `Channel.readWith` / `Channel.readWithCause` | Handle upstream input, failure, and completion |
| `Channel.flatMap`                            | Sequence channels using done values            |
| `Channel.pipeTo`                             | Connect one channel output to another input    |
| `Channel.fromEffect`                         | Lift an `Effect` into a `Channel`              |
| `Channel.succeed` / `Channel.fail`           | End with success or failure                    |
| `Channel.runCollect`                         | Run and collect outputs into `Array<OutElem>`  |
| `Channel.runDrain`                           | Run and ignore outputs                         |

### Concise Example

```ts
import { Channel, Effect } from "effect";

const channel = Channel.fromIterable([1, 2]);

const result = Effect.runSync(Channel.runCollect(channel));
// result is [1, 2]
```

### Use Cases

- Implementing custom stream/sink operators
- Bridging callback or protocol-style APIs to streams
- Fine-grained control of streamed input/output completion

## Chunk

`Chunk<A>` is Effect's immutable, efficient sequence type for ordered values. It is heavily used by
`Stream`, `Channel`, and collection-returning APIs.

### Key APIs

| API                                                  | Purpose                          |
| ---------------------------------------------------- | -------------------------------- |
| `Chunk.empty` / `Chunk.make` / `Chunk.fromIterable`  | Construct chunks                 |
| `Chunk.get` / `Chunk.getUnsafe`                      | Read by index safely or unsafely |
| `Chunk.append` / `Chunk.prepend` / `Chunk.appendAll` | Add elements                     |
| `Chunk.take` / `Chunk.drop` / `Chunk.splitAt`        | Slice-like operations            |
| `Chunk.map` / `Chunk.flatMap` / `Chunk.filter`       | Transform elements               |
| `Chunk.reduce`                                       | Fold to a single value           |
| `Chunk.head` / `Chunk.last`                          | Read first or last element       |
| `Chunk.toReadonlyArray` / `Chunk.toArray`            | Interop with JS arrays           |

### Concise Example

```ts
import { Chunk } from "effect";

const values = Chunk.make(1, 2, 3).pipe(
  Chunk.append(4),
  Chunk.map((n) => n * 2),
);

const asArray = Chunk.toReadonlyArray(values);
```

### Use Cases

- Buffering stream batches
- Returning immutable lists from pure functions
- Efficient append/prepend-heavy pipelines

## Partition and separate

`Array.partition(items, f)` takes `f` returning a `Result` and returns `[passes, fails]`:
**successes first**, then failures. `Array.separate(results)` has the same order, as do the `Chunk`
and `Record` equivalents, `Option.partitionMap`, and `Effect.partition(items, f)`, which returns
`Effect<[passes, fails], never, R>`. This is the reverse of `rc` builds, which returned
`[failures, successes]`.

```ts
import { Array, Result } from "effect";

const [ok, bad] = Array.partition([1, -2, 3], (n) =>
  n > 0 ? Result.succeed(n) : Result.fail(`neg:${n}`),
); // ok: [1, 3], bad: ["neg:-2"]
```

## DateTime

`DateTime` provides timezone-aware and UTC-safe time operations with predictable math and
formatting.

### Key APIs

| API                                                           | Purpose                              |
| ------------------------------------------------------------- | ------------------------------------ |
| `DateTime.now` / `DateTime.nowUnsafe`                         | Get current UTC time                 |
| `DateTime.make` / `DateTime.makeUnsafe`                       | Build from string/date/parts input   |
| `DateTime.makeZoned` / `DateTime.makeZonedUnsafe`             | Build with explicit zone handling    |
| `DateTime.zoneMakeNamed` / `DateTime.zoneMakeNamedUnsafe`     | Resolve named time zones             |
| `DateTime.setZone`                                            | Convert a `DateTime` to another zone |
| `DateTime.add` / `DateTime.subtract` / `DateTime.addDuration` | Time math                            |
| `DateTime.startOf` / `DateTime.endOf` / `DateTime.removeTime` | Calendar boundaries                  |
| `DateTime.format` / `DateTime.formatIso`                      | Render text output                   |

### Concise Example

```ts
import { DateTime, Effect } from "effect";

const program = Effect.gen(function* () {
  const now = yield* DateTime.now;
  return now.pipe(DateTime.add({ minutes: 30 }), DateTime.startOf("minute"), DateTime.formatIso);
});
```

### Use Cases

- Scheduling and expiration logic
- Timezone-aware user-facing timestamps
- Boundary math (start/end of day/week/month)

## HashMap

`HashMap<K, V>` is an immutable key-value map with Effect hashing and equality semantics.

### Key APIs

| API                                                       | Purpose                     |
| --------------------------------------------------------- | --------------------------- |
| `HashMap.empty` / `HashMap.make` / `HashMap.fromIterable` | Construct maps              |
| `HashMap.get` / `HashMap.has`                             | Lookup and membership       |
| `HashMap.set` / `HashMap.remove`                          | Add/update/remove entries   |
| `HashMap.modify` / `HashMap.modifyAt`                     | Update entries functionally |
| `HashMap.union`                                           | Merge maps                  |
| `HashMap.map` / `HashMap.flatMap` / `HashMap.filter`      | Transform/filter entries    |
| `HashMap.keys` / `HashMap.values` / `HashMap.entries`     | Iterate contents            |
| `HashMap.size` / `HashMap.isEmpty`                        | Size checks                 |

### Concise Example

```ts
import { HashMap, Option } from "effect";

const users = HashMap.make([1, "arya"], [2, "sam"]).pipe(
  HashMap.set(3, "lee"),
  HashMap.modify(2, (name) => name.toUpperCase()),
);

const maybeUser = HashMap.get(users, 2);
const fallback = Option.getOrElse(maybeUser, () => "unknown");
```

### Use Cases

- In-memory lookup tables
- Immutable caches and indexes
- Functional transforms over keyed data

## HashSet

`HashSet<A>` is an immutable set for uniqueness and fast membership checks using Effect
hashing/equality.

### Key APIs

| API                                                             | Purpose                          |
| --------------------------------------------------------------- | -------------------------------- |
| `HashSet.empty` / `HashSet.make` / `HashSet.fromIterable`       | Construct sets                   |
| `HashSet.has` / `HashSet.isSubset`                              | Membership and subset checks     |
| `HashSet.add` / `HashSet.remove`                                | Mutating-style immutable updates |
| `HashSet.union` / `HashSet.intersection` / `HashSet.difference` | Set algebra                      |
| `HashSet.map` / `HashSet.filter`                                | Transform/filter values          |
| `HashSet.reduce` / `HashSet.some` / `HashSet.every`             | Fold and inspect values          |
| `HashSet.size`                                                  | Cardinality                      |

### Concise Example

```ts
import { HashSet } from "effect";

const allowed = HashSet.make("read", "write").pipe(HashSet.add("admin"));

const readonlyOnly = HashSet.intersection(allowed, HashSet.make("read"));
```

### Use Cases

- Deduplication
- Permission/scope membership
- Fast set algebra in business rules

## Match

`Match` provides type-safe pattern matching for values and tagged unions. It replaces nested `if` /
`switch` blocks with composable, exhaustive branches.

### Key APIs

| API                                             | Purpose                                  |
| ----------------------------------------------- | ---------------------------------------- |
| `Match.type` / `Match.value`                    | Start type-based or value-based matching |
| `Match.when` / `Match.whenOr` / `Match.whenAnd` | Add branch conditions                    |
| `Match.tag` / `Match.tags`                      | Match on `_tag` unions                   |
| `Match.discriminator` / `Match.discriminators`  | Match custom discriminator keys          |
| `Match.not`                                     | Negated matching condition               |
| `Match.orElse` / `Match.orElseAbsurd`           | Fallback handling                        |
| `Match.option` / `Match.result`                 | Convert result to `Option` / `Result`    |
| `Match.exhaustive`                              | Require all cases to be handled          |

### Concise Example

```ts
import { Match } from "effect";

type Input =
  | { readonly _tag: "Ok"; readonly value: number }
  | { readonly _tag: "Err"; readonly message: string };

const render = Match.type<Input>().pipe(
  Match.tag("Ok", ({ value }) => `value=${value}`),
  Match.tag("Err", ({ message }) => `error=${message}`),
  Match.exhaustive,
);
```

### Use Cases

- Exhaustive union handling
- Declarative request/result branching
- Eliminating brittle nested conditionals

**Source:** `effect/Channel.ts` - see `~/Developer/effect/packages/effect/src/Channel.ts`
**Source:** `effect/Chunk.ts` - see `~/Developer/effect/packages/effect/src/Chunk.ts` **Source:**
`effect/DateTime.ts` - see `~/Developer/effect/packages/effect/src/DateTime.ts` **Source:**
`effect/HashMap.ts` - see `~/Developer/effect/packages/effect/src/HashMap.ts` **Source:**
`effect/HashSet.ts` - see `~/Developer/effect/packages/effect/src/HashSet.ts` **Source:**
`effect/Match.ts` - see `~/Developer/effect/packages/effect/src/Match.ts`
