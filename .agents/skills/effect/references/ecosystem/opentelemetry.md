# OpenTelemetry

Use `@effect/opentelemetry` for Effect-to-OpenTelemetry integration layers.

**Source:** `@effect/opentelemetry` - see `~/Developer/effect/packages/opentelemetry/src/`

## Module Overview

| Module | What it provides |
|--------|-----------------|
| `Tracer.make` | Tracer factory |
| `Tracer.layer` / `Tracer.layerGlobal` | Effect layer for tracing |
| `Tracer.layerampler` | Sampling-aware tracer layer |
| `Metrics.makeProducer` | Metrics producer factory |
| `Metrics.layer` | Effect layer for metrics |
| `Logger` | OpenTelemetry LogRecord exporter |
| `NodeSdk` | OpenTelemetry SDK for Node.js |
| `Resource` | Telemetry resource descriptors |
| `WebSdk` | OpenTelemetry SDK for browsers |

## Node SDK Layer

```ts
import { NodeSdk } from "@effect/opentelemetry"
import { Layer } from "effect"

const OtelLive = NodeSdk.layer(() => ({
  resource: { serviceName: "my-service" },
  spanProcessor: [],
  metricReader: [],
  logRecordProcessor: []
}))

const AppLive = Layer.mergeAll(OtelLive)
```

## Tracing

```ts
import { Tracer } from "@effect/opentelemetry"
import { Effect } from "effect"

const program = Effect.withSpan("my-operation")(Effect.succeed("result")).pipe(
  Effect.provide(Tracer.layer({ serviceName: "my-service" }))
)
```

Use `Effect.withSpan(name, options?)` to create spans around Effect operations. The tracer layer handles propagation and export.

## Metrics

```ts
import { Metrics } from "@effect/opentelemetry"
import { Effect, Metric } from "effect"

const requestCount = Metric.counter("http_requests").pipe(
  Metric.withDescription("Total HTTP requests")
)

const program = Effect.gen(function*() {
  yield* Metrics.increment(requestCount)
  return "done"
}).pipe(Effect.provide(Metrics.layer()))
```

## Instrumenting Effect Services

```ts
import { Tracer, Metrics } from "@effect/opentelemetry"
import { Effect, Layer } from "effect"

// Add AI-specific telemetry
const AiTelemetryLive = Layer.mergeAll(
  Tracer.layer({ serviceName: "ai-service" }),
  Metrics.layer()
)
```

## Logger Integration

```ts
import { Logger } from "@effect/opentelemetry"
import { NodeSdk } from "@effect/opentelemetry"
import { Layer } from "effect"

const OtelLive = NodeSdk.layer(() => ({
  resource: { serviceName: "my-service" },
  logRecordProcessor: [Logger.layer()]
}))
```

## Notes

- In v4, `Tracer` and `Metrics` moved to `effect/unstable/observability`. `NodeSdk` and `WebSdk` remain in `@effect/opentelemetry` since they are platform-specific SDKs.
- Requires OpenTelemetry SDK dependencies: `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-metrics-otlp-http`, etc.
- Span context propagation works automatically with `Effect.withSpan` and `HttpEffect` middleware.
