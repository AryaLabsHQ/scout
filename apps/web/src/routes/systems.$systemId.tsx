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
} from "@hugeicons/core-free-icons"

import { fetchSystemDetail, fetchSystemMetrics } from "@/server/systems"
import { useSystemState } from "@/providers/scout-provider"
import { MetricsChart } from "@/components/charts/metrics-chart"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  formatBytes,
  formatBytesPerSec,
  formatDuration,
  formatPercent,
  formatTimeAgo,
} from "@/lib/format"
import type { AgentReport } from "@scout/shared"

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
  reports: AgentReport[],
  extractor: (r: AgentReport) => Record<string, number>
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
  const wsState = useSystemState(systemId)

  const [selectedRange, setSelectedRange] = useState<TimeRange>("1h")
  const [historicalMetrics, setHistoricalMetrics] =
    useState<AgentReport[]>(initialMetrics)
  const [loadingRange, setLoadingRange] = useState(false)

  const system = wsState?.system ?? detail
  const latestMetrics = wsState?.latestMetrics ?? null

  async function handleRangeChange(range: TimeRange) {
    setSelectedRange(range)
    setLoadingRange(true)
    try {
      const hours = TIME_RANGES.find((r) => r.value === range)?.hours ?? 1
      const data = await fetchSystemMetrics({ data: { systemId, hours } })
      setHistoricalMetrics(data as AgentReport[])
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
    cpu: r.system?.cpu?.usage ?? 0,
  }))

  const memData = buildChartData(historicalMetrics, (r) => {
    const m = r.system?.memory
    return { mem: m ? (m.used / m.total) * 100 : 0 }
  })

  const diskIOData = buildChartData(historicalMetrics, (r) => {
    const disk = r.system?.disks?.[0]
    return {
      read: disk?.readBytesPerSec ?? 0,
      write: disk?.writeBytesPerSec ?? 0,
    }
  })

  // Network: collect all interface names
  const netInterfaces = new Set<string>()
  historicalMetrics.forEach((r) => r.network?.forEach((n) => netInterfaces.add(n.name)))
  const interfaceColors = ["#a855f7", "#ec4899", "#f97316", "#06b6d4", "#84cc16"]
  const netDataKeys = Array.from(netInterfaces).map((name, i) => ({
    key: `rx_${name}`,
    color: interfaceColors[i % interfaceColors.length] ?? "#a855f7",
    label: `${name} rx`,
  }))
  const netData = buildChartData(historicalMetrics, (r) => {
    const result: Record<string, number> = {}
    r.network?.forEach((n) => {
      result[`rx_${n.name}`] = n.rxBytesPerSec
    })
    return result
  })

  // GPU data
  const hasGpu = system.capabilities.gpu && latestMetrics?.gpu && latestMetrics.gpu.length > 0
  const gpuData = buildChartData(historicalMetrics, (r) => ({
    gpu: r.gpu?.[0]?.usage ?? 0,
    gpuMem: r.gpu?.[0] ? (r.gpu[0].memUsed / r.gpu[0].memTotal) * 100 : 0,
  }))

  // Temp data
  const hasTempData = historicalMetrics.some(
    (r) => r.temperatures && r.temperatures.length > 0
  )
  const tempLabels = new Set<string>()
  historicalMetrics.forEach((r) =>
    r.temperatures?.forEach((t) => tempLabels.add(t.label))
  )
  const tempColors = ["#ef4444", "#f97316", "#eab308", "#22c55e"]
  const tempDataKeys = Array.from(tempLabels).map((label, i) => ({
    key: `temp_${label}`,
    color: tempColors[i % tempColors.length] ?? "#ef4444",
    label,
  }))
  const tempData = buildChartData(historicalMetrics, (r) => {
    const result: Record<string, number> = {}
    r.temperatures?.forEach((t) => {
      result[`temp_${t.label}`] = t.celsius
    })
    return result
  })

  const caps = system.capabilities
  const capBadges = Object.entries(caps)
    .filter(([, v]) => v)
    .map(([k]) => k)

  return (
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
                <span>up {formatDuration(latestMetrics.system.uptime)}</span>
              )}
              {system.lastSeen && <span>last seen {formatTimeAgo(system.lastSeen)}</span>}
            </div>
          </div>

          {/* Capability badges */}
          <div className="flex flex-wrap gap-1">
            {capBadges.map((cap) => (
              <Badge key={cap} variant="secondary" className="text-[10px]">
                {cap}
              </Badge>
            ))}
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
              value: formatPercent(latestMetrics.system.cpu.usage),
              sub: `${latestMetrics.system.cpu.cores} cores`,
              color: "text-blue-500",
            },
            {
              icon: ServerStack01Icon,
              label: "Memory",
              value: formatPercent(
                (latestMetrics.system.memory.used / latestMetrics.system.memory.total) * 100
              ),
              sub: `${formatBytes(latestMetrics.system.memory.used)} / ${formatBytes(latestMetrics.system.memory.total)}`,
              color: "text-green-500",
            },
            {
              icon: DriveIcon,
              label: "Disk",
              value: latestMetrics.system.disks[0]
                ? formatPercent(
                    (latestMetrics.system.disks[0].used /
                      latestMetrics.system.disks[0].total) *
                      100
                  )
                : "N/A",
              sub: latestMetrics.system.disks[0]
                ? formatBytes(latestMetrics.system.disks[0].total)
                : "",
              color: "text-cyan-500",
            },
            {
              icon: WifiConnected01Icon,
              label: "Network",
              value: formatBytesPerSec(
                latestMetrics.network.reduce((s: number, n) => s + n.rxBytesPerSec, 0)
              ),
              sub: `↑ ${formatBytesPerSec(latestMetrics.network.reduce((s: number, n) => s + n.txBytesPerSec, 0))}`,
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
  )
}
