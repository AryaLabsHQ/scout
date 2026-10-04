import { useState } from "react"
import { lastValue } from "@/lib/async-result"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { toast } from "sonner"
import type { Alert } from "@scout/shared"
import { HubClient } from "@/rpc/client"
import { fetchAlerts } from "@/server/alerts"
import { useConfirm } from "@/providers/confirm-provider"
import { Button } from "@/components/ui/button"
import { EmptyRow, Page, PageHeader, Section } from "@/components/section"
import { TimeAgo } from "@/components/time-ago"
import { StatusDot } from "@/components/status-dot"
import { METRIC_LABELS, formatMetricValue } from "@/lib/health"
import { cn } from "@/lib/utils"

const TABS = ["open", "resolved", "rules"] as const
type Tab = (typeof TABS)[number]

export const Route = createFileRoute("/alerts")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } =>
    TABS.includes(search["tab"] as Tab) && search["tab"] !== "open" ? { tab: search["tab"] as Tab } : {},
  // `alerts.list` returns only open alerts; the REST bootstrap also carries the
  // last 24 h of resolved ones.
  loader: async () => ({ recent: await fetchAlerts().catch(() => [] as Alert[]) }),
  component: AlertsPage,
})

function AlertRow({
  alert,
  hostname,
  onAck,
  onResolve,
}: {
  alert: Alert
  hostname: string
  onAck: (alert: Alert) => void
  onResolve: (alert: Alert) => void
}) {
  const resolved = alert.state === "resolved"
  return (
    <tr className={cn("border-t border-border first:border-t-0", resolved && "opacity-55")}>
      <td className="truncate px-4 py-2.5">
        <span className="flex items-center gap-2.5">
          <StatusDot tone={resolved ? "off" : alert.severity === "critical" ? "err" : "warn"} label={alert.severity} />
          <span className="truncate">{METRIC_LABELS[alert.metric] ?? alert.metric}</span>
          <span className="truncate font-mono text-xs text-subtle">{alert.metric}</span>
        </span>
      </td>
      <td className="truncate px-4 py-2.5">
        <Link to="/systems/$systemId" params={{ systemId: alert.systemId }} className="font-mono hover:underline">
          {hostname}
        </Link>
      </td>
      <td className="px-4 py-2.5 font-mono tabular">{formatMetricValue(alert.metric, alert.value)}</td>
      <td className="px-4 py-2.5 text-muted-foreground">
        {alert.severity} · {alert.state}
      </td>
      <td className="px-4 py-2.5 text-muted-foreground">
        <TimeAgo at={alert.triggeredAt} />
        {alert.resolvedAt ? <span className="text-subtle"> · resolved <TimeAgo at={alert.resolvedAt} /></span> : null}
      </td>
      <td className="px-4 py-1.5 text-right whitespace-nowrap">
        {alert.state === "active" ? (
          <Button size="sm" variant="outline" onClick={() => onAck(alert)}>
            Acknowledge
          </Button>
        ) : null}
        {!resolved ? (
          <Button size="sm" variant="ghost" className="ml-1" onClick={() => onResolve(alert)}>
            Resolve
          </Button>
        ) : null}
      </td>
    </tr>
  )
}

function AlertsPage() {
  const { tab = "open" } = Route.useSearch()
  const { recent } = Route.useLoaderData()
  const confirm = useConfirm()
  const alertsResult = useAtomValue(HubClient.query("alerts.list", undefined))
  const systemsResult = useAtomValue(HubClient.query("systems.list", undefined))
  const rulesResult = useAtomValue(HubClient.query("alertRules.list", undefined))
  const ack = useAtomSet(HubClient.mutation("alerts.ack"), { mode: "promise" })
  const resolve = useAtomSet(HubClient.mutation("alerts.resolve"), { mode: "promise" })
  // Bridges the gap between a mutation and the next `alerts.list` refresh.
  const [overrides, setOverrides] = useState<Record<string, Alert>>({})

  const hostnames = new Map(
    lastValue(systemsResult, []).map((system) => [system.id, system.hostname]),
  )
  const live = lastValue(alertsResult, null)
  const liveIds = new Set(live?.map((alert) => alert.id))
  const merged = new Map<string, Alert>()
  for (const alert of recent) {
    // An alert that was open at page load but is missing from the live list has since closed.
    if (live !== null && alert.state !== "resolved" && !liveIds.has(alert.id)) continue
    merged.set(alert.id, alert)
  }
  for (const alert of live ?? []) merged.set(alert.id, alert)
  for (const [id, alert] of Object.entries(overrides)) merged.set(id, alert)
  const all = [...merged.values()].sort((a, b) => b.triggeredAt - a.triggeredAt)
  const open = all.filter((alert) => alert.state !== "resolved")
  const resolvedAlerts = all.filter((alert) => alert.state === "resolved")
  const rules = lastValue(rulesResult, [])

  const label = (alert: Alert) => `${METRIC_LABELS[alert.metric] ?? alert.metric} on ${hostnames.get(alert.systemId) ?? alert.systemId}`

  const onAck = async (alert: Alert) => {
    const confirmed = await confirm({
      title: `Acknowledge ${label(alert)}?`,
      description: "The alert stays open until its metric recovers, but it no longer counts as unseen.",
      confirmLabel: "Acknowledge",
    })
    if (!confirmed) return
    setOverrides((current) => ({ ...current, [alert.id]: { ...alert, state: "acknowledged", acknowledgedAt: Date.now() } }))
    try {
      await ack({ payload: { alertId: alert.id }, reactivityKeys: ["alerts"] })
    } catch {
      toast.error(`Could not acknowledge ${label(alert)}`)
    }
  }

  const onResolve = async (alert: Alert) => {
    const confirmed = await confirm({
      title: `Resolve ${label(alert)}?`,
      description: "Marks the alert resolved now. If the metric still breaches its rule, a new alert opens.",
      confirmLabel: "Resolve",
      destructive: true,
    })
    if (!confirmed) return
    setOverrides((current) => ({ ...current, [alert.id]: { ...alert, state: "resolved", resolvedAt: Date.now() } }))
    try {
      await resolve({ payload: { alertId: alert.id }, reactivityKeys: ["alerts"] })
    } catch {
      toast.error(`Could not resolve ${label(alert)}`)
    }
  }

  const rows = tab === "open" ? open : resolvedAlerts
  const counts: Record<Tab, number> = { open: open.length, resolved: resolvedAlerts.length, rules: rules.length }

  return (
    <Page>
      <PageHeader
        title="Alerts"
        meta={<span>Raised by the hub when a machine's metrics breach an alert rule</span>}
      />

      <div className="mt-6 flex gap-6 border-b border-border">
        {TABS.map((value) => (
          <Link
            key={value}
            to="/alerts"
            search={value === "open" ? {} : { tab: value }}
            className={cn(
              "-mb-px flex items-center gap-2 border-b px-0.5 py-2.5 text-[13px] capitalize",
              value === tab ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {value === "resolved" ? "Resolved · 24h" : value}
            <span className="font-mono text-xs text-subtle tabular">{counts[value]}</span>
          </Link>
        ))}
      </div>

      {tab === "rules" ? (
        <Section
          className="mt-6"
          aside={
            <Link to="/settings" className="text-muted-foreground hover:text-foreground">
              Edit in Settings →
            </Link>
          }
          title="Rules"
        >
          {rules.length === 0 ? (
            <EmptyRow>No alert rules.</EmptyRow>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border bg-raised text-xs text-subtle">
                  <th className="px-4 py-2 font-normal">Metric</th>
                  <th className="px-4 py-2 font-normal">Condition</th>
                  <th className="px-4 py-2 font-normal">For</th>
                  <th className="px-4 py-2 font-normal">Severity</th>
                  <th className="px-4 py-2 text-right font-normal">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className={cn("border-t border-border first:border-t-0", !rule.enabled && "opacity-55")}>
                    <td className="px-4 py-2.5">
                      {METRIC_LABELS[rule.metric] ?? rule.metric}{" "}
                      <span className="font-mono text-xs text-subtle">{rule.metric}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular">
                      {rule.operator} {rule.threshold}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {rule.consecutiveCount} sample{rule.consecutiveCount === 1 ? "" : "s"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        <StatusDot tone={rule.severity === "critical" ? "err" : "warn"} />
                        {rule.severity}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{rule.enabled ? "On" : "Off"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      ) : (
        <Section className="mt-6">
          {rows.length === 0 ? (
            <EmptyRow>
              <span className="flex items-center gap-2">
                <StatusDot tone="ok" />
                {tab === "open" ? "All clear: no open alerts." : "Nothing resolved in the last 24 hours."}
              </span>
            </EmptyRow>
          ) : (
            <table className="w-full table-fixed text-left text-[13px]">
              <thead>
                <tr className="border-b border-border bg-raised text-xs text-subtle">
                  <th className="px-4 py-2 font-normal">Alert</th>
                  <th className="w-36 px-4 py-2 font-normal">Machine</th>
                  <th className="w-24 px-4 py-2 font-normal">Value</th>
                  <th className="w-44 px-4 py-2 font-normal">Severity</th>
                  <th className="w-52 px-4 py-2 font-normal">Triggered</th>
                  <th className="w-52 px-4 py-2 font-normal" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((alert) => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    hostname={hostnames.get(alert.systemId) ?? alert.systemId}
                    onAck={(target) => void onAck(target)}
                    onResolve={(target) => void onResolve(target)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}
    </Page>
  )
}
