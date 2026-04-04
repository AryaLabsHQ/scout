import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeft01Icon,
  CpuIcon,
  DriveIcon,
  WifiConnected01Icon,
  ServerStack01Icon,
  GpuIcon,
  ThermometerIcon,
  ContainerIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons"

import { fetchSystemDetail, fetchSystemMetrics } from "@/server/systems"
import { fetchDockerContainers, fetchSystemdServices } from "@/server/workloads"
import { systemdAction, dockerAction, dockerInspect, getUnitFile, editUnitFile } from "@/server/management"
import { useSystemState } from "@/providers/scout-provider"
import { MetricsChart } from "@/components/charts/metrics-chart"
import { ConfirmAction } from "@/components/confirm-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { LogViewer } from "@/components/log-viewer"
import {
  formatBytes,
  formatBytesPerSec,
  formatDuration,
  formatPercent,
  formatTimeAgo,
} from "@/lib/format"
import type { AgentReport, DockerContainerMetrics, SystemdServiceMetrics, UnitFile } from "@scout/shared"

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

  // Docker / Systemd data
  const [dockerContainers, setDockerContainers] = useState<DockerContainerMetrics[] | null>(null)
  const [systemdServices, setSystemdServices] = useState<SystemdServiceMetrics[] | null>(null)
  const [logSheetOpen, setLogSheetOpen] = useState(false)
  const [logTarget, setLogTarget] = useState<string>("")
  const [logSource, setLogSource] = useState<"k8s" | "systemd">("systemd")

  // Unit file editor sheet
  const [unitFileSheetOpen, setUnitFileSheetOpen] = useState(false)
  const [unitFileData, setUnitFileData] = useState<UnitFile | null>(null)
  const [unitFileContent, setUnitFileContent] = useState("")
  const [unitFileLoading, setUnitFileLoading] = useState(false)

  // Docker inspect sheet
  const [inspectSheetOpen, setInspectSheetOpen] = useState(false)
  const [inspectData, setInspectData] = useState<unknown>(null)

  const system = wsState?.system ?? detail
  const latestMetrics = wsState?.latestMetrics ?? null

  // Load Docker/Systemd data when system is loaded
  useState(() => {
    if (!systemId) return
    if (system?.capabilities?.docker) {
      fetchDockerContainers({ data: { systemId } }).then(setDockerContainers).catch(() => {})
    }
    if (system?.capabilities?.systemd) {
      fetchSystemdServices({ data: { systemId } }).then(setSystemdServices).catch(() => {})
    }
  })

  function openLogViewer(target: string, source: "k8s" | "systemd") {
    setLogTarget(target)
    setLogSource(source)
    setLogSheetOpen(true)
  }

  async function openUnitFileEditor(unit: string) {
    setUnitFileLoading(true)
    setUnitFileSheetOpen(true)
    setUnitFileData(null)
    setUnitFileContent("")
    try {
      const file = await getUnitFile({ data: { systemId, unit } })
      setUnitFileData(file)
      setUnitFileContent(file.content)
    } catch {
      toast.error(`Could not load unit file for ${unit}`)
      setUnitFileSheetOpen(false)
    } finally {
      setUnitFileLoading(false)
    }
  }

  async function saveUnitFile() {
    if (!unitFileData) return
    setUnitFileLoading(true)
    try {
      await editUnitFile({ data: { systemId, unit: unitFileData.path.split("/").pop() ?? "", content: unitFileContent } })
      toast.success("Unit file saved")
      setUnitFileSheetOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed")
    } finally {
      setUnitFileLoading(false)
    }
  }

  async function openDockerInspect(containerId: string, containerName: string) {
    try {
      const text = await dockerInspect({ data: { systemId, containerId } })
      try {
        setInspectData(JSON.parse(text))
      } catch {
        setInspectData(text)
      }
      setInspectSheetOpen(true)
    } catch {
      toast.error(`Could not inspect container ${containerName}`)
    }
  }

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

        {/* Docker containers */}
        {system?.capabilities?.docker && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <HugeiconsIcon icon={ContainerIcon} size={14} className="text-blue-400" />
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Docker Containers
              </h2>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {dockerContainers ? `${dockerContainers.length} containers` : "Loading..."}
              </span>
            </div>
            {dockerContainers && dockerContainers.length > 0 ? (
              <DockerSection
                containers={dockerContainers}
                systemId={systemId}
                onRefresh={() => {
                  fetchDockerContainers({ data: { systemId } }).then(setDockerContainers).catch(() => {})
                }}
                onInspect={openDockerInspect}
              />
            ) : (
              <p className="text-xs text-muted-foreground">No containers found.</p>
            )}
          </section>
        )}

        {/* Systemd services */}
        {system?.capabilities?.systemd && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <HugeiconsIcon icon={Settings01Icon} size={14} className="text-orange-400" />
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Systemd Services
              </h2>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {systemdServices ? `${systemdServices.length} units` : "Loading..."}
              </span>
            </div>
            {systemdServices && systemdServices.length > 0 ? (
              <SystemdSection
                services={systemdServices}
                systemId={systemId}
                onViewLogs={openLogViewer}
                onEditUnit={openUnitFileEditor}
                onRefresh={() => {
                  fetchSystemdServices({ data: { systemId } }).then(setSystemdServices).catch(() => {})
                }}
              />
            ) : (
              <p className="text-xs text-muted-foreground">No services found.</p>
            )}
          </section>
        )}
      </div>
    </div>

    {/* Log viewer sheet */}
    <Sheet open={logSheetOpen} onOpenChange={setLogSheetOpen}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col" showCloseButton={false}>
        <SheetHeader className="sr-only">
          <SheetTitle>Logs — {logTarget}</SheetTitle>
        </SheetHeader>
        {logSheetOpen && (
          <LogViewer
            agentId={systemId}
            source={logSource}
            target={logTarget}
            onClose={() => setLogSheetOpen(false)}
          />
        )}
      </SheetContent>
    </Sheet>

    {/* Unit file editor sheet */}
    <Sheet open={unitFileSheetOpen} onOpenChange={setUnitFileSheetOpen}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="font-heading text-sm">
            {unitFileData ? `Edit: ${unitFileData.path}` : "Loading unit file..."}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-hidden flex flex-col p-4 gap-3">
          {unitFileLoading && !unitFileData ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : (
            <>
              <textarea
                className="flex-1 w-full resize-none rounded-none border border-border bg-background font-mono text-[11px] p-3 focus:outline-none focus:ring-1 focus:ring-foreground/20"
                value={unitFileContent}
                onChange={(e) => setUnitFileContent(e.target.value)}
                spellCheck={false}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setUnitFileSheetOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" disabled={unitFileLoading} onClick={saveUnitFile}>
                  {unitFileLoading ? "Saving..." : "Save"}
                </Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>

    {/* Docker inspect sheet */}
    <Sheet open={inspectSheetOpen} onOpenChange={setInspectSheetOpen}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="font-heading text-sm">Container Inspect</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-auto p-4">
          <pre className="font-mono text-[11px] text-foreground whitespace-pre-wrap break-all">
            {JSON.stringify(inspectData, null, 2)}
          </pre>
        </div>
      </SheetContent>
    </Sheet>
  </>
  )
}

// ── DockerSection ─────────────────────────────────────────────────────────────

function DockerStateBadge({ state }: { state: DockerContainerMetrics["state"] }) {
  const map: Record<DockerContainerMetrics["state"], string> = {
    running: "bg-green-500/20 text-green-400 border-green-500/30",
    paused: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    exited: "bg-muted text-muted-foreground border-border",
    restarting: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    dead: "bg-red-500/20 text-red-400 border-red-500/30",
    created: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  }
  return (
    <span className={`inline-flex items-center rounded-none border px-1.5 py-0 text-[10px] font-medium ${map[state]}`}>
      {state}
    </span>
  )
}

function DockerSection({
  containers,
  systemId,
  onRefresh,
  onInspect,
}: {
  containers: DockerContainerMetrics[]
  systemId: string
  onRefresh: () => void
  onInspect: (containerId: string, name: string) => void
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function handleDockerAction(containerId: string, name: string, action: "start" | "stop" | "restart" | "remove") {
    setLoadingId(`${containerId}-${action}`)
    try {
      await dockerAction({ data: { systemId, containerId, action } })
      toast.success(`${action.charAt(0).toUpperCase() + action.slice(1)}ed ${name}`)
      onRefresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${action} failed`)
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Image</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>CPU%</TableHead>
          <TableHead>Memory</TableHead>
          <TableHead>Network</TableHead>
          <TableHead>Uptime</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {containers.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="font-mono text-[11px]">{c.name}</TableCell>
            <TableCell className="max-w-[200px] truncate font-mono text-[10px] text-muted-foreground">
              {c.image}
            </TableCell>
            <TableCell><DockerStateBadge state={c.state} /></TableCell>
            <TableCell>{c.cpuPercent.toFixed(1)}%</TableCell>
            <TableCell>
              {c.memLimit > 0
                ? `${formatBytes(c.memUsed)} / ${formatBytes(c.memLimit)}`
                : formatBytes(c.memUsed)}
            </TableCell>
            <TableCell className="text-[10px]">
              ↓{formatBytes(c.netRx)} ↑{formatBytes(c.netTx)}
            </TableCell>
            <TableCell>{formatDuration(c.uptime)}</TableCell>
            <TableCell>
              <div className="flex gap-1">
                <ConfirmAction
                  title={`Restart ${c.name}?`}
                  description={`This will restart the container on the agent.`}
                  action="Restart"
                  variant="default"
                  onConfirm={() => handleDockerAction(c.id, c.name, "restart")}
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px]"
                    disabled={!!loadingId}
                  >
                    Restart
                  </Button>
                </ConfirmAction>
                <ConfirmAction
                  title={`Stop ${c.name}?`}
                  description={`This will stop the running container.`}
                  action="Stop"
                  variant="destructive"
                  onConfirm={() => handleDockerAction(c.id, c.name, "stop")}
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px]"
                    disabled={!!loadingId || c.state !== "running"}
                  >
                    Stop
                  </Button>
                </ConfirmAction>
                <ConfirmAction
                  title={`Remove ${c.name}?`}
                  description={`This will permanently remove the container. This action cannot be undone.`}
                  action="Remove"
                  variant="destructive"
                  onConfirm={() => handleDockerAction(c.id, c.name, "remove")}
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px] text-destructive hover:text-destructive"
                    disabled={!!loadingId}
                  >
                    Remove
                  </Button>
                </ConfirmAction>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => onInspect(c.id, c.name)}
                >
                  Inspect
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ── SystemdSection ────────────────────────────────────────────────────────────

function SystemdStateBadge({ state }: { state: SystemdServiceMetrics["activeState"] }) {
  const map: Record<SystemdServiceMetrics["activeState"], string> = {
    active: "bg-green-500/20 text-green-400 border-green-500/30",
    inactive: "bg-muted text-muted-foreground border-border",
    failed: "bg-red-500/20 text-red-400 border-red-500/30",
    activating: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    deactivating: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  }
  return (
    <span className={`inline-flex items-center rounded-none border px-1.5 py-0 text-[10px] font-medium ${map[state]}`}>
      {state}
    </span>
  )
}

function SystemdSection({
  services,
  systemId,
  onViewLogs,
  onEditUnit,
  onRefresh,
}: {
  services: SystemdServiceMetrics[]
  systemId: string
  onViewLogs: (target: string, source: "k8s" | "systemd") => void
  onEditUnit: (unit: string) => void
  onRefresh: () => void
}) {
  const [loadingUnit, setLoadingUnit] = useState<string | null>(null)

  async function handleSystemdAction(unit: string, action: "start" | "stop" | "restart" | "enable" | "disable") {
    setLoadingUnit(`${unit}-${action}`)
    try {
      await systemdAction({ data: { systemId, unit, action } })
      toast.success(`${action.charAt(0).toUpperCase() + action.slice(1)}ed ${unit}`)
      onRefresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${action} failed`)
    } finally {
      setLoadingUnit(null)
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Unit</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Sub</TableHead>
          <TableHead>PID</TableHead>
          <TableHead>Memory</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {services.map((svc) => (
          <TableRow key={svc.unit} className={svc.loadState === "masked" ? "opacity-40 line-through" : ""}>
            <TableCell className="font-mono text-[11px]">{svc.unit}</TableCell>
            <TableCell><SystemdStateBadge state={svc.activeState} /></TableCell>
            <TableCell className="text-[10px] text-muted-foreground">{svc.subState}</TableCell>
            <TableCell className="font-mono text-[11px]">{svc.pid ?? "—"}</TableCell>
            <TableCell>
              {svc.memoryBytes !== null ? formatBytes(svc.memoryBytes) : "—"}
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                <ConfirmAction
                  title={`Restart ${svc.unit}?`}
                  description={`This will restart the service on the agent.`}
                  action="Restart"
                  variant="default"
                  onConfirm={() => handleSystemdAction(svc.unit, "restart")}
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px]"
                    disabled={!!loadingUnit}
                  >
                    Restart
                  </Button>
                </ConfirmAction>
                {svc.activeState === "active" ? (
                  <ConfirmAction
                    title={`Stop ${svc.unit}?`}
                    description={`This will stop the running service.`}
                    action="Stop"
                    variant="destructive"
                    onConfirm={() => handleSystemdAction(svc.unit, "stop")}
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px]"
                      disabled={!!loadingUnit}
                    >
                      Stop
                    </Button>
                  </ConfirmAction>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px]"
                    disabled={!!loadingUnit || svc.loadState === "masked"}
                    onClick={() => handleSystemdAction(svc.unit, "start")}
                  >
                    Start
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => onViewLogs(svc.unit, "systemd")}
                  disabled={!systemId}
                >
                  Logs
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => onEditUnit(svc.unit)}
                >
                  Edit Unit
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
