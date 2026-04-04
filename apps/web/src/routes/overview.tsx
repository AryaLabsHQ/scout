import { createFileRoute } from "@tanstack/react-router"
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
  const { systems: wsState } = useScout()

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

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-heading text-base font-semibold">Systems</h1>
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
              <SystemCard key={entry.system.id} systemState={entry} />
            ) : null
          )}
        </div>
      )}
    </div>
  )
}
