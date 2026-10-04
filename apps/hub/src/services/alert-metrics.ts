import type { SystemMetricsSample } from "@scout/shared"
import type { PluginCollectionResult } from "@scout/plugin-sdk"

export interface AlertMetricSample {
  readonly metric: string
  readonly value: number
}

export const alertMetricSamplesFromCoreMetrics = (
  sample: SystemMetricsSample,
): ReadonlyArray<AlertMetricSample> => {
  const samples: AlertMetricSample[] = [{ metric: "cpu.usage", value: sample.cpuPercent }]

  if (sample.memoryTotalBytes > 0) {
    samples.push({
      metric: "memory.percent",
      value: sample.memoryPercent,
    })
  }

  if (sample.diskPercent !== null) {
    samples.push({
      metric: "disk.percent",
      value: sample.diskPercent,
    })
  }

  if (sample.gpuTemperatureCelsius !== null) {
    samples.push({
      metric: "gpu.temperature",
      value: sample.gpuTemperatureCelsius,
    })
  }

  if (sample.smartHealthFailing) {
    samples.push({
      metric: "smart.health",
      value: 1,
    })
  }

  return samples
}

export const alertMetricSamplesFromPluginCollection = (
  collection: PluginCollectionResult,
): ReadonlyArray<AlertMetricSample> =>
  (collection.metrics ?? [])
    .filter((point) => point.entity === undefined)
    .map((point) => ({
      metric: `${point.pluginId}.${point.metricId}`,
      value: point.value,
    }))
