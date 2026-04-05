import { useNavigate } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert01Icon,
  ContainerIcon,
  CpuIcon,
  DriveIcon,
  WifiConnected01Icon,
} from "@hugeicons/core-free-icons"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { SparklineChart } from "@/components/charts/sparkline-chart"
import { ProgressBar } from "@/components/charts/progress-bar"
import { formatPercent, formatBytes, formatBytesPerSec, formatTimeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AgentReport, System } from "@scout/shared"

/** Minimal shape that SystemCard needs — compatible with both legacy SystemState and the new atom shape */
export interface SystemState {
  system: System
  latestMetrics: AgentReport | null
  cpuHistory: number[]
}

const METRIC_COLORS = {
  cpu: "#3b82f6",
  mem: "#22c55e",
  disk: "#06b6d4",
  net: "#a855f7",
} as const

interface SystemCardProps {
  systemState: SystemState
  alertCount?: number
}

export function SystemCard({ systemState, alertCount = 0 }: SystemCardProps) {
  const { system, latestMetrics, cpuHistory } = systemState
  const navigate = useNavigate()

  const isOnline = system.status === "online"
  const lastSeen = system.lastSeen ? formatTimeAgo(system.lastSeen) : "never"

  // Derived metrics
  const cpu = latestMetrics?.system.cpu.usage ?? 0
  const mem = latestMetrics
    ? (latestMetrics.system.memory.used / latestMetrics.system.memory.total) * 100
    : 0
  const disk = latestMetrics?.system.disks[0]
    ? (latestMetrics.system.disks[0].used / latestMetrics.system.disks[0].total) * 100
    : 0

  const totalRx = latestMetrics
    ? latestMetrics.network.reduce((s: number, n) => s + n.rxBytesPerSec, 0)
    : 0
  const totalTx = latestMetrics
    ? latestMetrics.network.reduce((s: number, n) => s + n.txBytesPerSec, 0)
    : 0

  const caps = system.capabilities
  const capBadges: string[] = []
  if (caps.k8s) capBadges.push("k8s")
  if (caps.docker) capBadges.push("docker")
  if (caps.gpu) capBadges.push("gpu")
  if (caps.systemd) capBadges.push("systemd")

  return (
    <Card
      className="cursor-pointer transition-all hover:ring-2 hover:ring-primary/50"
      onClick={() => navigate({ to: "/systems/$systemId", params: { systemId: system.id } })}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {/* Status dot */}
              <span
                className={cn(
                  "inline-block h-2 w-2 shrink-0 rounded-full",
                  isOnline ? "bg-green-500" : "bg-muted-foreground"
                )}
              />
              <p className="truncate font-heading text-sm font-semibold">
                {system.hostname}
              </p>
            </div>
            <p className="mt-0.5 pl-4 text-[10px] text-muted-foreground">
              {isOnline ? "Online" : `Last seen ${lastSeen}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {alertCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive/20 px-1 text-[10px] font-medium text-destructive">
                <HugeiconsIcon icon={Alert01Icon} size={10} className="mr-0.5" />
                {alertCount}
              </span>
            )}
            {capBadges.map((cap) => (
              <Badge key={cap} variant="outline" className="h-4 px-1 text-[9px]">
                {cap}
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {/* Metrics rows */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={CpuIcon} size={12} className="shrink-0 text-blue-500" />
            <span className="w-8 shrink-0 text-[10px] text-muted-foreground">CPU</span>
            <ProgressBar value={cpu} label={formatPercent(cpu)} className="flex-1" />
          </div>
          <div className="flex items-center gap-2">
            <span className="ml-0.5 w-3 shrink-0 text-[10px] font-bold text-green-500">M</span>
            <span className="w-8 shrink-0 text-[10px] text-muted-foreground">MEM</span>
            <ProgressBar value={mem} label={formatPercent(mem)} className="flex-1" />
          </div>
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={DriveIcon} size={12} className="shrink-0 text-cyan-500" />
            <span className="w-8 shrink-0 text-[10px] text-muted-foreground">DISK</span>
            <ProgressBar value={disk} label={formatPercent(disk)} className="flex-1" />
          </div>
        </div>

        {/* Network summary */}
        {latestMetrics && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <HugeiconsIcon icon={WifiConnected01Icon} size={12} className="text-purple-500" />
            <span className="text-purple-400">↓ {formatBytesPerSec(totalRx)}</span>
            <span className="text-purple-400">↑ {formatBytesPerSec(totalTx)}</span>
            {system.capabilities.k8s && latestMetrics.k8s && (
              <>
                <span className="ml-auto flex items-center gap-1">
                  <HugeiconsIcon icon={ContainerIcon} size={12} />
                  {latestMetrics.k8s.pods?.length ?? 0} pods
                </span>
              </>
            )}
          </div>
        )}

        {/* CPU Sparkline */}
        {cpuHistory.length > 1 && (
          <div className="pt-1">
            <SparklineChart data={cpuHistory} color={METRIC_COLORS.cpu} height={40} />
          </div>
        )}

        {/* Memory details */}
        {latestMetrics && (
          <p className="text-[10px] text-muted-foreground">
            {formatBytes(latestMetrics.system.memory.used)} /{" "}
            {formatBytes(latestMetrics.system.memory.total)}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
