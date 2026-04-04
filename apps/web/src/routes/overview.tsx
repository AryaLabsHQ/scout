import { createFileRoute, Link } from "@tanstack/react-router"
import { fetchSystems } from "@/server/systems"
import { useScout } from "@/providers/scout-provider"
import { SystemCard } from "@/components/system-card"
import type { System } from "@scout/shared"

export const Route = createFileRoute("/overview")({
  loader: async () => {
    const systems = await fetchSystems()
    return { systems }
  },
  component: OverviewPage,
})

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
  const { systems: loaderData } = Route.useLoaderData()
  const { systems: wsState, alerts, activeAlertCount } = useScout()

  // Merge SSR seed with WS live state
  // WS state takes precedence for online systems
  const allSystemIds = new Set([
    ...loaderData.map((s: System) => s.id),
    ...Object.keys(wsState),
  ])

  const mergedSystems = Array.from(allSystemIds).map((id) => {
    const wsEntry = wsState[id]
    const loaderSystem = loaderData.find((s: System) => s.id === id)
    if (wsEntry) return wsEntry
    if (loaderSystem) {
      return {
        system: loaderSystem,
        latestMetrics: null,
        cpuHistory: [] as number[],
      }
    }
    return null
  }).filter(Boolean)

  // Build per-system active alert count from WS alerts
  const alertCountBySystem: Record<string, number> = {}
  for (const alert of alerts) {
    if (alert.state === "active" || alert.state === "acknowledged") {
      alertCountBySystem[alert.systemId] = (alertCountBySystem[alert.systemId] ?? 0) + 1
    }
  }

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
          {mergedSystems.length} {mergedSystems.length === 1 ? "server" : "servers"}
        </span>
      </div>

      {mergedSystems.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {mergedSystems.map((entry) =>
            entry ? (
              <SystemCard
                key={entry.system.id}
                systemState={entry}
                alertCount={alertCountBySystem[entry.system.id] ?? 0}
              />
            ) : null
          )}
        </div>
      )}
    </div>
  )
}
