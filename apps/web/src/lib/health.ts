import type { AlertRule } from "@scout/shared"
import type { StatusTone } from "@/components/status-dot"

/** Alert rule metric ids for the core health strip. */
export const HEALTH_METRICS = {
  cpu: "cpu.usage",
  memory: "memory.percent",
  disk: "disk.percent",
} as const

/** Readable names for alert metrics; unknown metrics fall back to their id. */
export const METRIC_LABELS: Record<string, string> = {
  "cpu.usage": "CPU usage",
  "memory.percent": "Memory used",
  "disk.percent": "Disk used",
  "gpu.temperature": "GPU temperature",
  "smart.health": "SMART health",
  "systemd.units.failed": "Failed system units",
  "systemd.user-units.failed": "Failed user units",
}

/** Metrics whose values are whole counts, shown without a decimal. */
const COUNT_METRICS = new Set(["systemd.units.failed", "systemd.user-units.failed"])

export const METRIC_UNITS: Record<string, string> = {
  "cpu.usage": "%",
  "memory.percent": "%",
  "disk.percent": "%",
  "gpu.temperature": "°C",
}

const breaches = (rule: AlertRule, value: number): boolean => {
  switch (rule.operator) {
    case ">":
      return value > rule.threshold
    case "<":
      return value < rule.threshold
    case "=":
      return value === rule.threshold
    case "!=":
      return value !== rule.threshold
  }
}

/**
 * Colour a health value only when it breaches an enabled alert rule for that
 * metric: red for a critical rule, amber for a warning one, otherwise neutral.
 */
export function ruleTone(
  rules: ReadonlyArray<AlertRule>,
  metric: string,
  value: number | null | undefined,
): StatusTone | null {
  if (value === null || value === undefined) return null
  const breached = rules.filter((rule) => rule.enabled && rule.metric === metric && breaches(rule, value))
  if (breached.some((rule) => rule.severity === "critical")) return "err"
  if (breached.length > 0) return "warn"
  return null
}

export function formatMetricValue(metric: string, value: number): string {
  if (COUNT_METRICS.has(metric)) return String(value)
  const unit = METRIC_UNITS[metric] ?? ""
  return `${value.toFixed(1)}${unit}`
}
