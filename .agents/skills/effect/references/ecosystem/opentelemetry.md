# OpenTelemetry

Use `@effect/opentelemetry` at the same version as `effect`. The package exports namespaces named
`NodeSdk`, `OtelLogger`, `OtelMetrics`, `OtelTracer`, `Resource`, and `WebSdk`. Examples importing
`Tracer`, `Metrics`, or `Logger` directly from `@effect/opentelemetry` are stale.

**Source:** `~/Developer/effect/packages/opentelemetry/src/`.

## Prefer the platform SDK layer

For Node applications, configure the signals through `NodeSdk.layer`:

```ts
import { NodeSdk } from "@effect/opentelemetry";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

const TelemetryLive = NodeSdk.layer(() => ({
  resource: {
    serviceName: "my-service",
    serviceVersion: "1.0.0",
  },
  spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter()),
}));
```

Add `metricReader` or `logRecordProcessor` to the same configuration when those signals are
required. Do not pass Effect layers where OpenTelemetry SDK processors/readers are expected.
`NodeSdk.layer` owns resource construction and scoped provider shutdown.

## Application instrumentation

Create spans with core Effect APIs after providing the SDK layer:

```ts
import { Effect } from "effect";

const program = Effect.succeed("result").pipe(Effect.withSpan("my-operation"));
```

Use core `Metric` APIs for Effect metrics; `OtelMetrics` exports the producer/reader bridge, not an
increment function:

```ts
import { Effect, Metric } from "effect";

const requestCount = Metric.counter("http_requests", {
  description: "Total HTTP requests",
});

const program = Effect.gen(function* () {
  yield* Metric.update(requestCount, 1);
  return "done";
});
```

`OtelMetrics.layer(reader, options?)` registers the Effect metric producer with one or more SDK
metric readers. `OtelLogger.layer` installs the Effect logger after providing an
`OtelLogger.OtelLoggerProvider`; normally let `NodeSdk.layer` assemble both.

## Lower-level namespaces

Use lower-level modules only when custom composition is required:

```ts
import { OtelLogger, OtelMetrics, OtelTracer, Resource } from "@effect/opentelemetry";
```

- `OtelTracer.layer`: create/install the Effect tracer from an OTel provider and resource.
- `OtelTracer.currentOtelSpan`: access the current OTel span, failing when no span exists.
- `OtelMetrics.makeProducer` / `OtelMetrics.layer`: bridge Effect metrics to metric readers.
- `OtelLogger.layerLoggerProvider` / `OtelLogger.layer`: construct a provider and install/merge the
  Effect logger.
- `Resource.layerFromEnv`: construct resource metadata from environment/configuration.

## Notes

- Register Node auto-instrumentations before importing modules they patch.
- Older-pinned consumers: check the installed package surface via
  [v4-beta-deltas.md](v4-beta-deltas.md) before pasting examples.

Compile the complete layer with the consumer's actual exporters/processors; imports alone do not
prove signal export or shutdown behavior.
