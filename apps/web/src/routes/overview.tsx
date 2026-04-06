import { createFileRoute, Link } from "@tanstack/react-router"
import { useAtomValue } from "@effect/atom-react"
import { HubClient } from "@/rpc/client"
import { SystemCard } from "@/components/system-card"
import type { System } from "@scout/shared"

export const Route = createFileRoute("/overview")({
  component: OverviewPage,
})

function SystemCardWithMetrics({
  system,
  alertCount,
}: {
  system: System
  alertCount: number
}) {
  const metricsResult = useAtomValue(
    HubClient.query("systems.metrics", { id: system.id, range: "1h" }),
  )
  const reports =
    metricsResult._tag === "Success" ? metricsResult.value : []
  const latestMetrics =
    (reports.length > 0 ? reports[reports.length - 1] : null)
  const cpuHistory = reports.map((r) => r.cpuPercent)

  return (
    <SystemCard
      systemState={{ system, latestMetrics, cpuHistory }}
      alertCount={alertCount}
    />
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="text-4xl">📡</div>
      <div>
        <p className="font-medium">No systems connected</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Install the Scout agent on a server to start monitoring.
        </p>
      </div>
    </div>
  )
}

function OverviewPage() {
  const systemsResult = useAtomValue(HubClient.query("systems.list", undefined))
  const alertsResult = useAtomValue(HubClient.query("alerts.list", undefined))

  const systems: System[] = systemsResult._tag === "Success" ? [...systemsResult.value] : []
  const alerts = alertsResult._tag === "Success" ? [...alertsResult.value] : []

  // Build per-system active alert count
  const alertCountBySystem: Record<string, number> = {}
  for (const alert of alerts) {
    if (alert.state === "active" || alert.state === "acknowledged") {
      alertCountBySystem[alert.systemId] = (alertCountBySystem[alert.systemId] ?? 0) + 1
    }
  }

  const activeAlertCount = Object.values(alertCountBySystem).reduce((s, n) => s + n, 0)

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-base font-semibold">Systems</h1>
          {activeAlertCount > 0 && (
            <Link to="/alerts" className="flex items-center gap-1">
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-medium text-destructive-foreground">
                {activeAlertCount}
              </span>
              <span className="text-[10px] text-destructive hidden sm:inline">active alerts</span>
            </Link>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {systems.length} {systems.length === 1 ? "server" : "servers"}
        </span>
      </div>

      {systemsResult._tag === "Initial" ? (
        <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
          Connecting...
        </div>
      ) : systemsResult._tag === "Failure" ? (
        <div className="flex items-center justify-center py-24 text-sm text-destructive">
          Failed to load systems
        </div>
      ) : systems.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {systems.map((system) => (
            <SystemCardWithMetrics
              key={system.id}
              system={system}
              alertCount={alertCountBySystem[system.id] ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  )
}
