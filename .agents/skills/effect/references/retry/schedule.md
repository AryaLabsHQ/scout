# Schedule

## Table of Contents

- [Core rules](#core-rules)
- [Combining schedules](#combining-schedules)
- [Polling workers](#polling-workers)
- [Per-item failure isolation](#per-item-failure-isolation)
- [Reusable retry policy](#reusable-retry-policy)
- [Rate-limit-aware typed retry](#rate-limit-aware-typed-retry)
- [Timeouts and delays](#timeouts-and-delays)
- [Sequencing and observation](#sequencing-and-observation)

`Schedule<Output, Input, Error, Env>`

defines retry/repeat policies. This page documents the skill's baseline release; consumers pinned to
an older beta map differences through [v4-beta-deltas.md](../ecosystem/v4-beta-deltas.md), which
owns the baseline and the Schedule consolidation that landed at beta.97.

## Core rules

- `Effect.retry(schedule)` acts on typed failures only; defects and interruptions are not retried.
- `Effect.repeat(schedule)` acts on successful results; a failure stops repetition unless the pass
  handles it first.
- The source effect runs once before the schedule is first stepped.
- `Schedule.recurs(3)` means three retries/repetitions _after_ that initial run.
- `Schedule.spaced(d)` waits `d` after each completion; `Schedule.fixed(d)` aligns executions to a
  fixed cadence regardless of how long the work takes.
- Use `Schedule.exponential(d)` or `Schedule.fibonacci(d)` for backoff.
- Add `Schedule.jittered` to spread retries and avoid synchronized retry storms.
- Bound a counter schedule with `Schedule.recurs(n)`; bound a delay schedule (e.g. `exponential`)
  with `Schedule.upTo({ times })` and/or `Schedule.upTo({ duration })`.
- `Schedule.tap(f)` observes each step via `Metadata<Output, Input>` (`input`, `output`,
  `duration`).
- `Effect.retryOrElse(schedule, orElse)` runs a fallback/reporting effect once retries are
  exhausted.
- Retry only at the narrowest boundary with proven idempotency. Exhausted failures should stay
  visible unless that boundary has a truthful fallback.

## Combining schedules

```ts
import { Effect, Schedule } from "effect";

const retryPolicy = Schedule.max([Schedule.exponential("100 millis"), Schedule.recurs(3)]).pipe(
  Schedule.jittered,
  Schedule.upTo({ times: 3 }),
);

const fastest = Schedule.min([Schedule.exponential("100 millis"), Schedule.spaced("1 second")]);

const program = Effect.fail("temporary error").pipe(Effect.retry(retryPolicy));
```

- `Schedule.min([...])`: recur while at least one schedule recurs and use the shortest delay.
- `Schedule.max([...])`: recur while every schedule recurs and use the longest delay.
- `Schedule.upTo({ times, duration })`: bound recurrences and/or elapsed duration.
- `Schedule.jittered`: add randomized delay to an existing schedule.
- `Schedule.once`: recurs immediately once, then completes; with `Effect.repeat` the effect runs
  twice in total (the initial run plus one recurrence).

## Polling workers

Prefer handling typed pass failures before repeating over recovering at the cause level.

```ts
const pass = runPass().pipe(
  Effect.tapError((error) => Effect.logError("Worker.pass_failed", error)),
  Effect.ignore,
);

const run = pass.pipe(Effect.repeat(Schedule.spaced("1 second")));
```

This shape says expected operational pass failures are logged and the worker continues. Defects
still defect and can reach supervision.

Use cause-level recovery only at true supervision boundaries where the policy really is "report
every non-interrupt failure and continue":

```ts
const logNonInterruptCauseAndContinue = (message: string) =>
  Effect.catchCauseIf(
    (cause) => !Cause.hasInterrupts(cause),
    (cause) => Effect.logError(message, cause),
  );
```

`Effect.catchCauseIf(predicate, handler)` takes the predicate first and the handler second. Do not
catch causes just to make failures disappear. When only expected typed failures should recover, use
`Effect.catchIf`, `Effect.catchFilter`, `Effect.catchTag`, or `Effect.retry` on those typed errors
instead.

## Per-item failure isolation

For batch workers, isolate expected item-level typed failures around each item so one bad item does
not stall the batch.

```ts
yield *
  Effect.forEach(
    items,
    (item) =>
      processItem(item).pipe(
        Effect.tapError((error) =>
          Effect.logError("Worker.item_failed", error).pipe(
            Effect.annotateLogs({ itemId: item.id }),
          ),
        ),
        Effect.ignore,
      ),
    { discard: true, concurrency: 5 },
  );
```

Only do this when skipping or deferring the item is truthful product policy.

## Reusable retry policy

Define named policies as module constants and compose retry-input logging at the use site with
`Schedule.tap`.

```ts
const projectionRetrySchedule: Schedule.Schedule<unknown, ProjectionError> = Schedule.exponential(
  "100 millis",
).pipe(Schedule.jittered, Schedule.upTo({ times: 5 }));

const reconcileWithRetry = (target: Target) =>
  reconcile(target).pipe(
    Effect.retryOrElse(
      projectionRetrySchedule.pipe(
        Schedule.tap((meta) =>
          Effect.logWarning("Agent.Projection.reconcile.retrying").pipe(
            Effect.annotateLogs({ operation: meta.input.operation }),
          ),
        ),
      ),
      (error) => Effect.logError("Agent.Projection.reconcile.stopped", error),
    ),
  );
```

Use this when the operation is idempotent and retry state is useful for logs or metrics.

## Rate-limit-aware typed retry

When provider errors carry a `retryAfterMs`, let the schedule take the larger of its own backoff
delay and the provider's requested delay. `Schedule.passthrough` makes each error the schedule
output so `Schedule.modifyDelay` can read it — the `modifyDelay` callback is positional,
`(output, delay)`, not an `{ input, duration }` object.

```ts
type RateLimited = { readonly retryAfterMs?: number | undefined };

// Annotate the backoff's input as the error type (contravariant), then pass it through as output.
const backoff: Schedule.Schedule<Duration.Duration, RateLimited> = Schedule.exponential(
  "200 millis",
).pipe(Schedule.jittered, Schedule.upTo({ times: 5 }));

const providerRetrySchedule: Schedule.Schedule<RateLimited, RateLimited> = backoff.pipe(
  Schedule.passthrough,
  Schedule.modifyDelay((error, delay) =>
    Effect.succeed(
      error.retryAfterMs === undefined
        ? delay
        : Duration.max(delay, Duration.millis(error.retryAfterMs)),
    ),
  ),
);
```

Use this for operation-level retries over typed provider errors. For proactive request pacing and
HttpClient-level 429 handling, prefer a rate limiter at the client boundary
(`HttpClient.retryTransient` / `HttpClient.withRateLimiter`, see
[platform.md](../ecosystem/platform.md)) over per-call retries.

## Timeouts and delays

- `Effect.timeout(d)` when the operation has a real deadline.
- `Effect.delay(d)` when one operation should start later.
- `Effect.sleep(d)` inside production workflows only when sleeping itself is the domain behavior.
- Avoid manual sleep loops; use `Effect.repeat` with a `Schedule` for recurring work.
- In tests, drive time with `TestClock` rather than real time. See
  [testing-migration.md](../patterns/testing-migration.md).

## Sequencing and observation

`Schedule.concatResult(left, right)` sequences two phases and marks left outputs as `Result.Failure`
and right outputs as `Result.Success`.

`Schedule.tap((metadata) => …)` observes steps; `Metadata<Output, Input>` carries `input`, `output`,
and `duration`.

```ts
const observed = Schedule.exponential("100 millis").pipe(
  Schedule.tap((meta) => Effect.log(`next delay: ${meta.duration}`)),
);
```

**Sources:** `packages/effect/src/Schedule.ts`, `Effect.ts`, `Cause.ts`, and `Duration.ts` in
`~/Developer/effect`. Production snippets typechecked against the `effect` source at these
signatures.
