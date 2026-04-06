import type { CoreMetricsPayload, SystemMetricsSample } from "@scout/shared"

export function makeSystemMetricsSample(
  overrides?: Partial<SystemMetricsSample>,
): SystemMetricsSample {
  return {
    timestamp: Date.now(),
    cpuPercent: 42.5,
    cpuCores: 4,
    cpuPerCorePercent: [40, 45, 41, 44],
    cpuUserPercent: 30,
    cpuSystemPercent: 10,
    cpuIowaitPercent: 2,
    cpuStealPercent: 0,
    cpuIdlePercent: 58,
    memoryUsedBytes: 4_000_000_000,
    memoryTotalBytes: 8_000_000_000,
    memoryAvailableBytes: 4_000_000_000,
    memoryBuffersCacheBytes: 500_000_000,
    swapUsedBytes: 0,
    swapTotalBytes: 2_000_000_000,
    memoryPercent: 50,
    diskUsedBytes: 50_000_000_000,
    diskTotalBytes: 100_000_000_000,
    diskPercent: 50,
    diskReadBytesPerSec: 1024,
    diskWriteBytesPerSec: 2048,
    networkRxBytesPerSec: 1000,
    networkTxBytesPerSec: 500,
    networkRxBytesPerSecByInterface: { eth0: 1000 },
    networkTxBytesPerSecByInterface: { eth0: 500 },
    gpuPercent: null,
    gpuMemoryPercent: null,
    gpuTemperatureCelsius: null,
    temperaturesCelsius: {},
    smartHealthFailing: false,
    loadAvg1m: 1,
    loadAvg5m: 1.5,
    loadAvg15m: 2,
    uptimeSeconds: 86400,
    ...overrides,
  }
}

export function makeCoreMetricsPayload(
  systemId = "test-system-01",
  sampleOverrides?: Partial<SystemMetricsSample>,
): CoreMetricsPayload {
  return {
    systemId,
    sample: makeSystemMetricsSample(sampleOverrides),
  }
}
