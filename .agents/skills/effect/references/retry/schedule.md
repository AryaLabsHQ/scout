# Schedule

`Schedule<Output, Input, Error, Env>` defines retry/repeat policies as composable, declarative recurrence strategies.

## Common Policies

```ts
import { Effect, Schedule } from "effect"

const exponential = Schedule.exponential("100 millis")
const spaced = Schedule.spaced("30 seconds")
const limited = Schedule.recurs(5)
const forever = Schedule.forever
```

## Jittered

```ts
const jittered = exponential.pipe(Schedule.jittered)
```

## Combining Policies

```ts
// Either — continues while either side continues, takes shorter delay
const policy = Schedule.either(
  Schedule.exponential("100 millis"),
  Schedule.spaced("1 second")
)

// Both — continues while both sides continue, takes longer delay
const policy2 = Schedule.both(
  Schedule.recurs(5),
  Schedule.spaced("1 second")
)
```

## Using with Effect

```ts
import { Effect, Schedule } from "effect"

const retryPolicy = Schedule.exponential("100 millis").pipe(
  Schedule.both(Schedule.recurs(3))
)

const program = Effect.gen(function*() {
  const result = yield* Effect.retry(
    Effect.fail("temporary error"),
    retryPolicy
  )
})

const repeated = Effect.log("heartbeat").pipe(
  Effect.repeat(Schedule.spaced("30 seconds"))
)
```

## Observe iterations (`Schedule.tap`)

Since beta.71, observe full schedule metadata without changing delays:

```ts
const policy = Schedule.exponential("100 millis").pipe(
  Schedule.tap((output, input) => Effect.log(`retry ${output}`)),
  Schedule.both(Schedule.recurs(3))
)
```

## Adding Delay

Use `Schedule.addDelay` to add delay to a schedule:

```ts
const slower = Schedule.recurs(3).pipe(
  Schedule.addDelay(() => Effect.succeed("500 millis"))
)
```

**Source:** `effect/Schedule.ts` - see `~/Developer/effect/packages/effect/src/Schedule.ts`
