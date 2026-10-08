# Metric

**Source:** `effect/Metric.ts` - see `~/Developer/effect/packages/effect/src/Metric.ts`

`Metric` provides counters, gauges, histograms, summaries, and frequency metrics for observability.

## Basic Usage

```typescript
import { Effect, Metric } from "effect";

const requestsTotal = Metric.counter("http_requests_total");
const latencyMs = Metric.histogram(
  "http_latency_ms",
  Metric.linearBoundaries({ start: 0, width: 50, count: 20 }),
);

const handler = Effect.gen(function* () {
  yield* Metric.update(requestsTotal, 1);
  yield* Metric.update(latencyMs, 120);
  return "ok";
});
```

## Key Functions

| Function                             | Description                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `Metric.counter(name, options?)`     | Counter for totals                                                                                     |
| `Metric.gauge(name, options?)`       | Point-in-time value                                                                                    |
| `Metric.histogram(name, boundaries)` | Distribution over buckets (boundaries via `Metric.linearBoundaries` or `Metric.exponentialBoundaries`) |
| `Metric.summary(options)`            | Sliding-window summary                                                                                 |
| `Metric.frequency(name)`             | Count of string occurrences                                                                            |
| `Metric.update(metric, value)`       | Update any metric with a value                                                                         |

## Use Cases

- Request count and latency tracking
- Queue depth / resource pressure gauges
- Error frequencies by tag/code
