import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeft01Icon,
  CpuIcon,
  DriveIcon,
  WifiConnected01Icon,
  ServerStack01Icon,
  GpuIcon,
  ThermometerIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons"

import { fetchSystemDetail, fetchSystemMetrics } from "@/server/systems"
import { useAtomValue } from "@effect/atom-react"
import { HubClient } from "@/rpc/client"
import { useTerminalPanel } from "@/providers/terminal-provider"
import { MetricsChart } from "@/components/charts/metrics-chart"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button"
import {
  formatBytes,
  formatBytesPerSec,
  formatDuration,
  formatPercent,
  formatTimeAgo,
} from "@/lib/format"
import { getAvailablePluginCapabilities } from "@/lib/system-capabilities"
import type { SystemMetricsSample } from "@scout/shared"

// ── Types ─────────────────────────────────────────────────────────────────────

type TimeRange = "1h" | "6h" | "24h" | "7d" | "30d"

const TIME_RANGES: { label: string; value: TimeRange; hours: number }[] = [
  { label: "1h", value: "1h", hours: 1 },
  { label: "6h", value: "6h", hours: 6 },
  { label: "24h", value: "24h", hours: 24 },
  { label: "7d", value: "7d", hours: 168 },
  { label: "30d", value: "30d", hours: 720 },
]

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/systems/$systemId")({
  loader: async ({ params }) => {
    const [detail, metrics] = await Promise.all([
      fetchSystemDetail({ data: { systemId: params.systemId } }),
      fetchSystemMetrics({ data: { systemId: params.systemId, hours: 1 } }),
    ])
    return { detail, metrics: metrics ?? [] }
  },
  component: SystemDetailPage,
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildChartData(
  reports: SystemMetricsSample[],
  extractor: (r: SystemMetricsSample) => Record<string, number>
) {
  return reports.map((r) => ({
    time: new Date(r.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    ...extractor(r),
  }))
}

// ── Component ─────────────────────────────────────────────────────────────────

function SystemDetailPage() {
  const { systemId } = Route.useParams()
  const { detail, metrics: initialMetrics } = Route.useLoaderData()
  // Live system data from atom query; falls back to loader data when loading
  const systemResult = useAtomValue(HubClient.query("systems.get", { id: systemId }))
  const liveSystem = systemResult._tag === "Success" ? systemResult.value : null
  const { sessions, openSession } = useTerminalPanel()

  const [selectedRange, setSelectedRange] = useState<TimeRange>("1h")
  const [historicalMetrics, setHistoricalMetrics] =
    useState<SystemMetricsSample[]>(initialMetrics)
  const [loadingRange, setLoadingRange] = useState(false)

  const system = liveSystem ?? detail
  const latestMetrics = historicalMetrics[historicalMetrics.length - 1] ?? detail?.latestMetrics ?? null

  async function handleRangeChange(range: TimeRange) {
    setSelectedRange(range)
    setLoadingRange(true)
    try {
      const hours = TIME_RANGES.find((r) => r.value === range)?.hours ?? 1
      const data = await fetchSystemMetrics({ data: { systemId, hours } })
      setHistoricalMetrics(data)
    } finally {
      setLoadingRange(false)
    }
  }

  if (!system) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">System not found.</p>
      </div>
    )
  }

  // Build chart datasets
  const cpuData = buildChartData(historicalMetrics, (r) => ({
    cpu: r.cpuPercent,
  }))

  const memData = buildChartData(historicalMetrics, (r) => ({ mem: r.memoryPercent }))

  const diskIOData = buildChartData(historicalMetrics, (r) => {
    return {
      read: r.diskReadBytesPerSec,
      write: r.diskWriteBytesPerSec,
    }
  })

  // Network: collect all interface names
  const netInterfaces = new Set<string>()
  historicalMetrics.forEach((r) =>
    Object.keys(r.networkRxBytesPerSecByInterface).forEach((name) => netInterfaces.add(name)),
  )
  const interfaceColors = ["#a855f7", "#ec4899", "#f97316", "#06b6d4", "#84cc16"]
  const netDataKeys = Array.from(netInterfaces).map((name, i) => ({
    key: `rx_${name}`,
    color: interfaceColors[i % interfaceColors.length] ?? "#a855f7",
    label: `${name} rx`,
  }))
  const netData = buildChartData(historicalMetrics, (r) => {
    const result: Record<string, number> = {}
    for (const [name, rx] of Object.entries(r.networkRxBytesPerSecByInterface)) {
      result[`rx_${name}`] = rx
    }
    return result
  })

  // GPU data
  const hasGpu = historicalMetrics.some((report) => report.gpuPercent !== null)
  const gpuData = buildChartData(historicalMetrics, (r) => ({
    gpu: r.gpuPercent ?? 0,
    gpuMem: r.gpuMemoryPercent ?? 0,
  }))

  // Temp data
  const hasTempData = historicalMetrics.some(
    (r) => Object.keys(r.temperaturesCelsius).length > 0,
  )
  const tempLabels = new Set<string>()
  historicalMetrics.forEach((r) =>
    Object.keys(r.temperaturesCelsius).forEach((label) => tempLabels.add(label))
  )
  const tempColors = ["#ef4444", "#f97316", "#eab308", "#22c55e"]
  const tempDataKeys = Array.from(tempLabels).map((label, i) => ({
    key: `temp_${label}`,
    color: tempColors[i % tempColors.length] ?? "#ef4444",
    label,
  }))
  const tempData = buildChartData(historicalMetrics, (r) => {
    const result: Record<string, number> = {}
    for (const [label, celsius] of Object.entries(r.temperaturesCelsius)) {
      result[`temp_${label}`] = celsius
    }
    return result
  })

  const pluginCapabilities = getAvailablePluginCapabilities(system)

  return (
    <>
    <div className="p-4 md:p-6">
      {/* Back + Header */}
      <div className="mb-4">
        <Link
          to="/overview"
          className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
          Back
        </Link>

        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  system.status === "online" ? "bg-green-500" : "bg-muted-foreground"
                }`}
              />
              <h1 className="font-heading text-lg font-semibold">{system.hostname}</h1>
              <Badge variant="outline" className="text-[10px]">
                {system.status}
              </Badge>
            </div>

            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {system.tailscaleIp && <span>{system.tailscaleIp}</span>}
              {latestMetrics && (
                <span>up {formatDuration(latestMetrics.uptimeSeconds)}</span>
              )}
              {system.lastSeen && <span>last seen {formatTimeAgo(system.lastSeen)}</span>}
            </div>
          </div>

          {/* Capability badges + actions */}
          <div className="flex flex-col gap-2 items-end">
            {(() => {
              const sessionCount = sessions.filter(
                (t) => t.kind === "interactive" && t.agentId === systemId,
              ).length
              const hasSessions = sessionCount > 0
              return (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  disabled={system.status !== "online"}
                  onClick={() =>
                    openSession({
                      agentId: systemId,
                      mode: "shell",
                      label: system.hostname,
                    })
                  }
                >
                  <HugeiconsIcon icon={TerminalIcon} size={12} />
                  {hasSessions ? `New terminal (${sessionCount})` : "Open Terminal"}
                </Button>
              )
            })()}
            {pluginCapabilities.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-end">
                {pluginCapabilities.map((plugin) => (
                  <Link
                    key={plugin.pluginId}
                    to="/systems/$systemId/plugins/$pluginId"
                    params={{ systemId, pluginId: plugin.pluginId }}
                    className={buttonVariants({
                      size: "sm",
                      variant: "outline",
                      className: "h-7 text-[10px]",
                    })}
                  >
                    {plugin.pluginId}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live metric summary */}
      {latestMetrics && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              icon: CpuIcon,
              label: "CPU",
              value: formatPercent(latestMetrics.cpuPercent),
              sub: `${latestMetrics.cpuCores} cores`,
              color: "text-blue-500",
            },
            {
              icon: ServerStack01Icon,
              label: "Memory",
              value: formatPercent(latestMetrics.memoryPercent),
              sub: `${formatBytes(latestMetrics.memoryUsedBytes)} / ${formatBytes(latestMetrics.memoryTotalBytes)}`,
              color: "text-green-500",
            },
            {
              icon: DriveIcon,
              label: "Disk",
              value: latestMetrics.diskPercent !== null
                ? formatPercent(latestMetrics.diskPercent)
                : "N/A",
              sub: latestMetrics.diskTotalBytes !== null
                ? formatBytes(latestMetrics.diskTotalBytes)
                : "",
              color: "text-cyan-500",
            },
            {
              icon: WifiConnected01Icon,
              label: "Network",
              value: formatBytesPerSec(latestMetrics.networkRxBytesPerSec),
              sub: `↑ ${formatBytesPerSec(latestMetrics.networkTxBytesPerSec)}`,
              color: "text-purple-500",
            },
          ].map(({ icon, label, value, sub, color }) => (
            <div
              key={label}
              className="rounded-none border border-border bg-card p-3 ring-1 ring-foreground/10"
            >
              <div className="flex items-center gap-1.5">
                <HugeiconsIcon icon={icon} size={14} className={color} />
                <span className="text-[10px] text-muted-foreground">{label}</span>
              </div>
              <p className="mt-1 font-heading text-lg font-semibold">{value}</p>
              <p className="text-[10px] text-muted-foreground">{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Time range selector */}
      <div className="mb-4 flex items-center gap-1">
        {TIME_RANGES.map((range) => (
          <Button
            key={range.value}
            variant={selectedRange === range.value ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => handleRangeChange(range.value)}
            disabled={loadingRange}
          >
            {range.label}
          </Button>
        ))}
      </div>

      {/* Charts */}
      <div className="space-y-6">
        {/* CPU */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <HugeiconsIcon icon={CpuIcon} size={14} className="text-blue-500" />
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              CPU Usage
            </h2>
          </div>
          <MetricsChart
            data={cpuData}
            dataKeys={[{ key: "cpu", color: "#3b82f6", label: "CPU %" }]}
            unit="%"
            height={180}
          />
        </section>

        {/* Memory */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <HugeiconsIcon icon={ServerStack01Icon} size={14} className="text-green-500" />
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Memory Usage
            </h2>
          </div>
          <MetricsChart
            data={memData}
            dataKeys={[{ key: "mem", color: "#22c55e", label: "Mem %" }]}
            unit="%"
            height={180}
          />
        </section>

        {/* Disk I/O */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <HugeiconsIcon icon={DriveIcon} size={14} className="text-cyan-500" />
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Disk I/O
            </h2>
          </div>
          <MetricsChart
            data={diskIOData}
            dataKeys={[
              { key: "read", color: "#06b6d4", label: "Read" },
              { key: "write", color: "#8b5cf6", label: "Write" },
            ]}
            unit="bytes/s"
            height={180}
            type="line"
          />
        </section>

        {/* Network */}
        {netDataKeys.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <HugeiconsIcon icon={WifiConnected01Icon} size={14} className="text-purple-500" />
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Network
              </h2>
            </div>
            <MetricsChart
              data={netData}
              dataKeys={netDataKeys}
              unit="bytes/s"
              height={180}
              type="line"
            />
          </section>
        )}

        {/* GPU */}
        {hasGpu && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <HugeiconsIcon icon={GpuIcon} size={14} className="text-yellow-500" />
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                GPU
              </h2>
            </div>
            <MetricsChart
              data={gpuData}
              dataKeys={[
                { key: "gpu", color: "#eab308", label: "GPU %" },
                { key: "gpuMem", color: "#f97316", label: "VRAM %" },
              ]}
              unit="%"
              height={180}
            />
          </section>
        )}

        {/* Temperature */}
        {hasTempData && tempDataKeys.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <HugeiconsIcon icon={ThermometerIcon} size={14} className="text-red-400" />
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Temperature
              </h2>
            </div>
            <MetricsChart
              data={tempData}
              dataKeys={tempDataKeys}
              unit="%" // use raw value label
              height={180}
              type="line"
            />
          </section>
        )}

      </div>
    </div>
  </>
  )
}
