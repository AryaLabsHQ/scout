import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { lastValue } from "@/lib/async-result"
import { useAtomValue } from "@effect/atom-react"
import type { System } from "@scout/shared"
import { HubClient } from "@/rpc/client"
import { fetchSystems } from "@/server/systems"
import { useRefreshInterval } from "@/hooks/use-refresh-interval"
import { bySystemOrder } from "@/hooks/use-current-system"
import { EmptyRow, Page, PageHeader, Section } from "@/components/section"
import { Sparkline } from "@/components/sparkline"
import { TimeAgo } from "@/components/time-ago"
import { StatusDot } from "@/components/status-dot"

/**
 * `/` sends a single-machine install straight to that machine's overview; the
 * fleet list only appears once two or more machines report.
 */
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const systems = await fetchSystems().catch(() => [] as System[])
    if (systems.length === 1) {
      throw redirect({ to: "/systems/$systemId", params: { systemId: systems[0]!.id } })
    }
  },
  component: FleetPage,
})

function FleetRow({ system, activeAlerts }: { system: System; activeAlerts: number }) {
  const navigate = useNavigate()
  const metricsAtom = HubClient.query("systems.metrics", { id: system.id, range: "1h" })
  useRefreshInterval(metricsAtom)
  const result = useAtomValue(metricsAtom)
  const samples = lastValue(result, [])
  const latest = samples.at(-1) ?? null
  const online = system.status === "online"

  return (
    <tr
      className="cursor-pointer border-t border-border first:border-t-0 hover:bg-raised"
      onClick={() => void navigate({ to: "/systems/$systemId", params: { systemId: system.id } })}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <StatusDot tone={online ? "ok" : "off"} />
          <span className="font-mono text-[13px]">{system.hostname}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-[13px] text-muted-foreground">
        {online ? "Online" : <TimeAgo at={system.lastSeen} prefix="Last seen " />}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="w-10 font-mono text-[13px] tabular">
            {latest ? `${latest.cpuPercent.toFixed(0)}%` : "—"}
          </span>
          <Sparkline values={samples.map((sample) => sample.cpuPercent)} max={100} width={80} height={20} />
        </div>
      </td>
      <td className="px-4 py-3 font-mono text-[13px] tabular">
        {latest ? `${latest.memoryPercent.toFixed(0)}%` : "—"}
      </td>
      <td className="px-4 py-3 font-mono text-[13px] tabular">
        {latest?.diskPercent != null ? `${latest.diskPercent.toFixed(0)}%` : "—"}
      </td>
      <td className="px-4 py-3 text-right text-[13px]">
        {activeAlerts > 0 ? (
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <StatusDot tone="err" />
            {activeAlerts} active
          </span>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </td>
    </tr>
  )
}

function FleetPage() {
  const systemsResult = useAtomValue(HubClient.query("systems.list", undefined))
  const alertsResult = useAtomValue(HubClient.query("alerts.list", undefined))
  const systems = [...lastValue(systemsResult, [])].sort(bySystemOrder)
  const alerts = lastValue(alertsResult, [])
  const online = systems.filter((system) => system.status === "online").length

  return (
    <Page>
      <PageHeader
        title="Machines"
        meta={
          <span>
            {systems.length} machines · {online} online
          </span>
        }
      />
      <Section className="mt-6">
        {systems.length === 0 ? (
          <EmptyRow>
            No machines are reporting yet. Start the Scout agent on a host with this hub's URL and token.
          </EmptyRow>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-raised text-xs text-subtle">
                <th className="px-4 py-2 font-normal">Machine</th>
                <th className="px-4 py-2 font-normal">Status</th>
                <th className="px-4 py-2 font-normal">CPU · 1h</th>
                <th className="px-4 py-2 font-normal">Memory</th>
                <th className="px-4 py-2 font-normal">Disk /</th>
                <th className="px-4 py-2 text-right font-normal">Alerts</th>
              </tr>
            </thead>
            <tbody>
              {systems.map((system) => (
                <FleetRow
                  key={system.id}
                  system={system}
                  activeAlerts={
                    alerts.filter((alert) => alert.systemId === system.id && alert.state === "active").length
                  }
                />
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </Page>
  )
}
