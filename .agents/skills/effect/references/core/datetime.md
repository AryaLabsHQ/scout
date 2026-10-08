# Clock and DateTime

Reading "now" inside an Effect workflow goes through `Clock` or `DateTime` so tests can replace time
with `TestClock`.

```
Current time?
├─ Millisecond timestamp inside Effect → Clock.currentTimeMillis
├─ Nanosecond wall-clock inside Effect → Clock.currentTimeNanos
├─ Monotonic elapsed nanos inside Effect → Clock.monotonicTimeNanos
├─ JavaScript Date inside Effect → DateTime.nowAsDate
├─ Semantic DateTime value / time-zone math → DateTime.now + DateTime helpers
├─ Sync wall-clock access outside Effect → DateTime.nowUnsafe / Date.now / new Date()
├─ Sleep, timeout, retry, schedule delay → Effect.sleep / Schedule via Clock
└─ Deterministic tests → it.effect + TestClock.setTime / TestClock.adjust
```

`Clock.currentTimeNanos` is wall-clock. `Effect.timed`, duration metrics, and `Sink.withDuration`
use monotonic time. Custom `Clock` implementations must provide both `monotonicTimeNanos` and
`monotonicTimeNanosUnsafe`. Subtract monotonic readings from the same clock only.

Sample once per logical state transition when several persisted fields or events need the same
timestamp.

## Boundary conversions are not time reads

Do not blanket-replace Date parsing, formatting, persistence codecs, or platform boundary APIs just
because they mention `Date`. `new Date(input)`, `date.toISOString()`, durable or platform scheduler
APIs, and third-party SDK contracts are boundary conversions unless they are reading "now". Let a
Schema codec own the wire form — see
[../schema/schema.md](../schema/schema.md#let-schema-own-wire-encoding).

## Deterministic test

```ts
import { DateTime, Effect } from "effect";
import { TestClock } from "effect/testing";
import { assert, it } from "@effect/vitest";

const markSent = Effect.gen(function* () {
  const sentAt = yield* DateTime.nowAsDate;
  return { status: "sent" as const, sentAt };
});

it.effect("uses deterministic time", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-01-01T00:00:00.000Z"));
    const result = yield* markSent;
    assert.strictEqual(result.sentAt.toISOString(), "2026-01-01T00:00:00.000Z");
  }),
);
```

## Related

| Topic                            | Reference                                        |
| -------------------------------- | ------------------------------------------------ |
| `Clock` as a runtime service     | [runtime-services.md](runtime-services.md)       |
| Schedule delays, retry, repeat   | [../retry/schedule.md](../retry/schedule.md)     |
| `TestClock` in tests             | [../ecosystem/vitest.md](../ecosystem/vitest.md) |
| Date codecs at the wire boundary | [../schema/schema.md](../schema/schema.md)       |

---

**Source:** `effect/Clock.ts` - see `~/Developer/effect/packages/effect/src/Clock.ts`

**Source:** `effect/DateTime.ts` - see `~/Developer/effect/packages/effect/src/DateTime.ts`

**Source:** `effect/testing/TestClock.ts` - see
`~/Developer/effect/packages/effect/src/testing/TestClock.ts`
