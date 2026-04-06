import { Schema } from "effect"

export const SystemMetricsSampleSchema = Schema.Struct({
  timestamp: Schema.Number,
  cpuPercent: Schema.Number,
  cpuCores: Schema.Number,
  cpuPerCorePercent: Schema.Array(Schema.Number),
  cpuUserPercent: Schema.Number,
  cpuSystemPercent: Schema.Number,
  cpuIowaitPercent: Schema.Number,
  cpuStealPercent: Schema.Number,
  cpuIdlePercent: Schema.Number,
  memoryUsedBytes: Schema.Number,
  memoryTotalBytes: Schema.Number,
  memoryAvailableBytes: Schema.Number,
  memoryBuffersCacheBytes: Schema.Number,
  swapUsedBytes: Schema.Number,
  swapTotalBytes: Schema.Number,
  memoryPercent: Schema.Number,
  diskUsedBytes: Schema.NullOr(Schema.Number),
  diskTotalBytes: Schema.NullOr(Schema.Number),
  diskPercent: Schema.NullOr(Schema.Number),
  diskReadBytesPerSec: Schema.Number,
  diskWriteBytesPerSec: Schema.Number,
  networkRxBytesPerSec: Schema.Number,
  networkTxBytesPerSec: Schema.Number,
  networkRxBytesPerSecByInterface: Schema.Record(Schema.String, Schema.Number),
  networkTxBytesPerSecByInterface: Schema.Record(Schema.String, Schema.Number),
  gpuPercent: Schema.NullOr(Schema.Number),
  gpuMemoryPercent: Schema.NullOr(Schema.Number),
  gpuTemperatureCelsius: Schema.NullOr(Schema.Number),
  temperaturesCelsius: Schema.Record(Schema.String, Schema.Number),
  smartHealthFailing: Schema.Boolean,
  loadAvg1m: Schema.Number,
  loadAvg5m: Schema.Number,
  loadAvg15m: Schema.Number,
  uptimeSeconds: Schema.Number,
})

export const CoreMetricsPayloadSchema = Schema.Struct({
  systemId: Schema.String,
  sample: SystemMetricsSampleSchema,
})

export type SystemMetricsSample = typeof SystemMetricsSampleSchema.Type
export type CoreMetricsPayload = typeof CoreMetricsPayloadSchema.Type
