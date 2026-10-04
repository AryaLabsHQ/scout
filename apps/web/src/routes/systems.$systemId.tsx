import { useEffect, useState } from "react"
import { lastValue } from "@/lib/async-result"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import type { EntitySnapshot, EventRecord } from "@scout/plugin-sdk"
import type { Alert, OperatorSessionSummary, SystemMetricsSample } from "@scout/shared"
import { K8S_PLUGIN_ID } from "@scout/plugin-k8s/contracts"
import { EDGE_PLUGIN_ID } from "@scout/plugin-edge/contracts"
import { SYSTEMD_PLUGIN_ID } from "@scout/plugin-systemd/contracts"
import { HubClient } from "@/rpc/client"
import { fetchSystemDetail, fetchSystemMetrics } from "@/server/systems"
import { useRefreshInterval } from "@/hooks/use-refresh-interval"
import { useHydrated } from "@/hooks/use-hydrated"
import { usePins } from "@/hooks/use-pins"
import { pluginCapability, usePluginEntities, usePluginEvents } from "@/hooks/use-plugin-data"
import { useUnitAction } from "@/hooks/use-unit-action"
import { useConfirm } from "@/providers/confirm-provider"
import { useTerminalPanel } from "@/providers/terminal-provider"
import { Button } from "@/components/ui/button"
import { EmptyRow, GroupLabel, Page, PageHeader, Section } from "@/components/section"
import { Sparkline } from "@/components/sparkline"
import { TimeAgo } from "@/components/time-ago"
import { StatusDot, type StatusTone } from "@/components/status-dot"
import { TimersTable } from "@/components/timers-table"
import { UnitsTable } from "@/components/units-table"
import { pluginUnavailable } from "@/components/plugin-status"
import { formatBytes, formatBytesPerSec, formatDuration } from "@/lib/format"
import { HEALTH_METRICS, METRIC_LABELS, formatMetricValue, ruleTone } from "@/lib/health"
import { summarizeNamespaces, uniqueEvents } from "@/lib/k8s"
import { edgeSummary, edgeTone, isProxy, isTunnel } from "@/lib/edge"
import {
  byFailedThenName,
  byTimerPriority,
  isServiceEntity,
  isTimerEntity,
  pinKey,
  timerFailed,
  timerState,
  unitState,
} from "@/lib/systemd"
import { getAvailablePluginCapabilities } from "@/lib/system-capabilities"
import { toast } from "sonner"

export const Route = createFileRoute("/systems/$systemId")({
  loader: async ({ params }) => {
    const [detail, metrics] = await Promise.all([
      fetchSystemDetail({ data: { systemId: params.systemId } }),
      fetchSystemMetrics({ data: { systemId: params.systemId, hours: 1 } }),
    ])
    return { detail, metrics: metrics ?? [] }
  },
  component: MachineOverviewPage,
})

/** Re-render every `ms` so relative times ("updated 5s ago") stay current. */
function useTick(ms: number) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((tick) => tick + 1), ms)
    return () => window.clearInterval(id)
  }, [ms])
}

// ── Health strip ─────────────────────────────────────────────────────────────

interface HealthCell {
  readonly label: string
  readonly value: string
  readonly sub: string
  readonly series: ReadonlyArray<number>
  readonly max?: number
  readonly tone: StatusTone | null
}

function HealthStrip({ systemId, cells }: { systemId: string; cells: ReadonlyArray<HealthCell> }) {
  return (
    <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-lg border border-border lg:grid-cols-4">
      {cells.map((cell, index) => (
        <Link
          key={cell.label}
          to="/systems/$systemId/metrics"
          params={{ systemId }}
          className={[
            "group block min-w-0 px-5 py-4 transition-colors hover:bg-raised",
            index % 2 === 1 ? "border-l border-border" : "",
            index >= 2 ? "border-t border-border lg:border-t-0" : "",
            index === 2 ? "lg:border-l" : "",
          ].join(" ")}
        >
          <div className="flex justify-between text-[12.5px] text-muted-foreground">
            <span>{cell.label}</span>
            <span className="text-subtle group-hover:text-muted-foreground">1h →</span>
          </div>
          <div className="mt-1.5 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div
                className={[
                  "font-mono text-[22px] font-medium tracking-tight tabular",
                  cell.tone === "err" ? "text-err" : cell.tone === "warn" ? "text-warn" : "",
                ].join(" ")}
              >
                {cell.value}
              </div>
              <div className="mt-0.5 truncate text-xs text-subtle">{cell.sub}</div>
            </div>
            <Sparkline
              values={cell.series}
              max={cell.max}
              tone={cell.tone ?? "neutral"}
              className="hidden sm:block"
            />
          </div>
        </Link>
      ))}
    </div>
  )
}

function healthCells(
  samples: ReadonlyArray<SystemMetricsSample>,
  latest: SystemMetricsSample | null,
  rules: Parameters<typeof ruleTone>[0],
): ReadonlyArray<HealthCell> {
  if (latest === null) return []
  return [
    {
      label: "CPU",
      value: `${latest.cpuPercent.toFixed(0)}%`,
      sub: `${latest.cpuCores} cores · iowait ${latest.cpuIowaitPercent.toFixed(1)}%`,
      series: samples.map((sample) => sample.cpuPercent),
      max: 100,
      tone: ruleTone(rules, HEALTH_METRICS.cpu, latest.cpuPercent),
    },
    {
      label: "Memory",
      value: `${latest.memoryPercent.toFixed(0)}%`,
      sub: `${formatBytes(latest.memoryUsedBytes)} / ${formatBytes(latest.memoryTotalBytes)}${
        latest.swapTotalBytes > 0 ? ` · swap ${formatBytes(latest.swapUsedBytes)}` : ""
      }`,
      series: samples.map((sample) => sample.memoryPercent),
      max: 100,
      tone: ruleTone(rules, HEALTH_METRICS.memory, latest.memoryPercent),
    },
    {
      label: "Disk /",
      value: latest.diskPercent === null ? "—" : `${latest.diskPercent.toFixed(0)}%`,
      sub:
        latest.diskUsedBytes !== null && latest.diskTotalBytes !== null
          ? `${formatBytes(latest.diskUsedBytes)} / ${formatBytes(latest.diskTotalBytes)}`
          : "no root filesystem",
      series: samples.map((sample) => sample.diskReadBytesPerSec + sample.diskWriteBytesPerSec),
      tone: ruleTone(rules, HEALTH_METRICS.disk, latest.diskPercent),
    },
    {
      label: "Network",
      value: formatBytesPerSec(latest.networkRxBytesPerSec),
      sub: `↑ ${formatBytesPerSec(latest.networkTxBytesPerSec)}`,
      series: samples.map((sample) => sample.networkRxBytesPerSec + sample.networkTxBytesPerSec),
      tone: null,
    },
  ]
}

// ── Services ─────────────────────────────────────────────────────────────────

function ServicesSection({
  systemId,
  hostname,
  system,
}: {
  systemId: string
  hostname: string
  system: Parameters<typeof pluginUnavailable>[0]
}) {
  const entities = usePluginEntities(systemId, SYSTEMD_PLUGIN_ID)
  const units = { loading: entities.loading, items: entities.items.filter(isServiceEntity) }
  const { pins, isPinned, toggle } = usePins(systemId)
  const { run } = useUnitAction(systemId, hostname)
  const unavailable = pluginUnavailable(system, SYSTEMD_PLUGIN_ID, "systemd")
  const failed = units.items.filter((unit) => unitState(unit).activeState === "failed").sort(byFailedThenName)
  const active = units.items.filter((unit) => unitState(unit).activeState === "active").length
  const pinned = pins
    .map((key) => units.items.find((unit) => pinKey(unitState(unit).scope, unit.ref.id) === key))
    .filter((unit): unit is EntitySnapshot => unit !== undefined && !failed.includes(unit))

  return (
    <Section
      title="Services"
      aside={
        <>
          {units.items.length > 0 ? (
            <span>
              systemd · <span className="tabular">{active}</span> active ·{" "}
              <span className={failed.length > 0 ? "text-err tabular" : "tabular"}>{failed.length}</span>{" "}
              failed
            </span>
          ) : null}
          <Link
            to="/systems/$systemId/services"
            params={{ systemId }}
            className="text-muted-foreground hover:text-foreground"
          >
            View all →
          </Link>
        </>
      }
    >
      {unavailable ??
        (units.loading ? (
          <EmptyRow>Loading units…</EmptyRow>
        ) : (
          <>
            <GroupLabel aside={<span className="tabular">{failed.length}</span>}>FAILED</GroupLabel>
            {failed.length > 0 ? (
              <UnitsTable
                systemId={systemId}
                units={failed}
                isPinned={isPinned}
                onTogglePin={toggle}
                onAction={run}
              />
            ) : (
              <EmptyRow>
                <span className="flex items-center gap-2">
                  <StatusDot tone="ok" /> No failed units
                </span>
              </EmptyRow>
            )}
            <GroupLabel
              aside={
                <Link
                  to="/systems/$systemId/services"
                  params={{ systemId }}
                  className="hover:text-foreground"
                >
                  ☆ Pin from Services
                </Link>
              }
            >
              PINNED IN THIS BROWSER
            </GroupLabel>
            {pinned.length > 0 ? (
              <UnitsTable
                systemId={systemId}
                units={pinned}
                isPinned={isPinned}
                onTogglePin={toggle}
                onAction={run}
              />
            ) : (
              <EmptyRow>Nothing pinned yet. Use ☆ on any unit in Services to keep it here.</EmptyRow>
            )}
          </>
        ))}
    </Section>
  )
}

// ── Cluster ──────────────────────────────────────────────────────────────────

function ClusterSection({
  systemId,
  system,
}: {
  systemId: string
  system: Parameters<typeof pluginUnavailable>[0]
}) {
  const entities = usePluginEntities(systemId, K8S_PLUGIN_ID)
  const events = usePluginEvents(systemId, K8S_PLUGIN_ID, 1)
  const unavailable = pluginUnavailable(system, K8S_PLUGIN_ID, "Kubernetes")
  const namespaces = summarizeNamespaces(entities.items)
  const warnings = uniqueEvents(events.items).filter((event) => event.severity !== "info")

  return (
    <Section
      title="Cluster"
      aside={
        <>
          {namespaces.length > 0 ? (
            <span>
              k8s · {namespaces.length} namespace{namespaces.length === 1 ? "" : "s"}
            </span>
          ) : null}
          <Link
            to="/systems/$systemId/cluster"
            params={{ systemId }}
            className="text-muted-foreground hover:text-foreground"
          >
            View all →
          </Link>
        </>
      }
    >
      {unavailable ??
        (entities.loading ? (
          <EmptyRow>Loading cluster…</EmptyRow>
        ) : namespaces.length === 0 ? (
          <EmptyRow>No workloads reported yet.</EmptyRow>
        ) : (
          <>
            <table className="w-full table-fixed text-left text-[13px]">
              <tbody>
                {namespaces.map((namespace) => (
                  <tr key={namespace.name} className="border-t border-border first:border-t-0">
                    <td className="w-[34%] truncate px-4 py-2.5">
                      <Link
                        to="/systems/$systemId/cluster"
                        params={{ systemId }}
                        search={{ namespace: namespace.name }}
                        className="flex items-center gap-2.5 hover:underline"
                      >
                        <StatusDot tone={namespace.tone} />
                        <span className="truncate font-mono">{namespace.name}</span>
                      </Link>
                    </td>
                    <td className="truncate px-4 py-2.5 text-muted-foreground">
                      {namespace.workloads.map((workload) => workload.name).join(", ") ||
                        `${namespace.pods} pods`}
                    </td>
                    <td className="w-20 px-4 py-2.5 text-right font-mono tabular text-muted-foreground">
                      {namespace.workloads.length > 0
                        ? `${namespace.readyWorkloads}/${namespace.workloads.length}`
                        : `${namespace.readyPods}/${namespace.pods}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <GroupLabel aside={<span className="tabular">{warnings.length}</span>}>
              WARNING EVENTS · 1H
            </GroupLabel>
            {warnings.length === 0 ? (
              <EmptyRow>No warning events</EmptyRow>
            ) : (
              <ul>
                {warnings.slice(0, 4).map((event) => (
                  <li
                    key={`${event.eventId}:${event.entity?.id ?? ""}:${event.ts}`}
                    className="flex gap-3 border-t border-border px-4 py-2.5 text-[13px] first:border-t-0"
                  >
                    <StatusDot tone="warn" className="mt-1.5" />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      <span className="font-mono text-foreground">{event.entity?.id ?? event.eventId}</span>{" "}
                      {event.message}
                    </span>
                    <span className="shrink-0 text-subtle">
                      <TimeAgo at={event.ts} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ))}
    </Section>
  )
}

// ── Ingress ──────────────────────────────────────────────────────────────────

/** cloudflared tunnels and Caddy from the edge plugin; renders nothing until the plugin reports. */
function IngressSection({
  systemId,
  system,
}: {
  systemId: string
  system: Parameters<typeof pluginUnavailable>[0]
}) {
  const entities = usePluginEntities(systemId, EDGE_PLUGIN_ID)
  const capability = pluginCapability(system, EDGE_PLUGIN_ID)
  // Tunnels first, then proxies; each kind in name order.
  const rows = [...entities.items.filter(isTunnel), ...entities.items.filter(isProxy)]
  if (capability === null || capability.status === "unsupported" || rows.length === 0) return null

  return (
    <Section
      title="Ingress"
      aside={
        <>
          <span>tunnel + proxy</span>
          <Link
            to="/systems/$systemId/plugins/$pluginId"
            params={{ systemId, pluginId: EDGE_PLUGIN_ID }}
            className="text-muted-foreground hover:text-foreground"
          >
            View all →
          </Link>
        </>
      }
    >
      <table className="w-full table-fixed text-left text-[13px]">
        <tbody>
          {rows.map((entity) => (
            <tr
              key={`${entity.ref.kind}/${entity.ref.id}`}
              className="border-t border-border first:border-t-0"
            >
              <td className="w-[34%] truncate px-4 py-2.5">
                <span className="flex items-center gap-2.5">
                  <StatusDot tone={edgeTone(entity)} label={entity.status} />
                  <span className="truncate font-mono" title={entity.ref.id}>
                    {entity.ref.id}
                  </span>
                </span>
              </td>
              <td className="truncate px-4 py-2.5 text-muted-foreground">{edgeSummary(entity)}</td>
              <td className="w-24 px-4 py-2.5 text-right text-subtle">{entity.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

// ── Backups & timers ─────────────────────────────────────────────────────────

const OVERVIEW_TIMERS = 5

/** systemd timers, failed and backups first; renders nothing until the plugin reports timers. */
function BackupsSection({ systemId }: { systemId: string }) {
  const entities = usePluginEntities(systemId, SYSTEMD_PLUGIN_ID)
  const timers = entities.items.filter(isTimerEntity).sort(byTimerPriority)
  if (timers.length === 0) return null
  const failed = timers.filter((timer) => timerFailed(timerState(timer))).length

  return (
    <Section
      title="Backups & timers"
      aside={
        <>
          <span>
            systemd timers · <span className="tabular">{timers.length}</span>
            {failed > 0 ? (
              <>
                {" "}
                · <span className="text-err tabular">{failed}</span> failed
              </>
            ) : null}
          </span>
          <Link
            to="/systems/$systemId/services"
            params={{ systemId }}
            hash="timers"
            className="text-muted-foreground hover:text-foreground"
          >
            View all →
          </Link>
        </>
      }
    >
      <TimersTable systemId={systemId} timers={timers.slice(0, OVERVIEW_TIMERS)} />
    </Section>
  )
}

// ── Activity ─────────────────────────────────────────────────────────────────

interface ActivityItem {
  readonly at: number
  readonly key: string
  readonly node: React.ReactNode
  readonly dim?: boolean
}

function ActivitySection({
  systemId,
  alerts,
  sessions,
  events,
}: {
  systemId: string
  alerts: ReadonlyArray<Alert>
  sessions: ReadonlyArray<OperatorSessionSummary>
  events: ReadonlyArray<EventRecord>
}) {
  const confirm = useConfirm()
  const ack = useAtomSet(HubClient.mutation("alerts.ack"), { mode: "promise" })
  const acknowledge = async (alert: Alert) => {
    const label = METRIC_LABELS[alert.metric] ?? alert.metric
    const confirmed = await confirm({
      title: `Acknowledge ${label} on ${alert.systemId}?`,
      description: "The alert stays open until its metric recovers, but it no longer counts as unseen.",
      confirmLabel: "Acknowledge",
    })
    if (!confirmed) return
    try {
      await ack({ payload: { alertId: alert.id }, reactivityKeys: ["alerts"] })
      toast.success(`${label} acknowledged`)
    } catch {
      toast.error(`Could not acknowledge ${label}`)
    }
  }

  const items: ActivityItem[] = [
    ...alerts
      .filter((alert) => alert.systemId === systemId)
      .map((alert) => ({
        at: alert.triggeredAt,
        key: `alert:${alert.id}`,
        dim: alert.state === "resolved",
        node: (
          <>
            <td className="w-[38%] truncate px-4 py-2.5">
              <span className="flex items-center gap-2.5">
                <StatusDot
                  tone={alert.state === "resolved" ? "off" : alert.severity === "critical" ? "err" : "warn"}
                />
                {/* Live values can move between the server render and hydration. */}
                <span className="truncate" suppressHydrationWarning>
                  {METRIC_LABELS[alert.metric] ?? alert.metric}{" "}
                  <span className="font-mono text-muted-foreground tabular" suppressHydrationWarning>
                    {formatMetricValue(alert.metric, alert.value)}
                  </span>
                </span>
              </span>
            </td>
            <td className="truncate px-4 py-2.5 text-muted-foreground">
              {alert.severity} · {alert.state}
            </td>
            <td className="w-24 px-4 py-2.5 text-right text-subtle">
              <TimeAgo at={alert.triggeredAt} />
            </td>
            <td className="w-36 px-4 py-1.5 text-right">
              {alert.state === "active" ? (
                <Button size="sm" variant="outline" onClick={() => void acknowledge(alert)}>
                  Acknowledge
                </Button>
              ) : null}
            </td>
          </>
        ),
      })),
    ...sessions
      .filter(
        (session) => session.status === "waiting_for_user" && session.selectedNodeIds.includes(systemId),
      )
      .map((session) => ({
        at: session.updatedAt,
        key: `session:${session.id}`,
        node: (
          <>
            <td className="w-[38%] truncate px-4 py-2.5">
              <span className="flex items-center gap-2.5">
                <StatusDot tone="warn" />
                <span className="truncate">
                  Operator · <span className="text-muted-foreground">{session.title}</span>
                </span>
              </span>
            </td>
            <td className="truncate px-4 py-2.5 text-muted-foreground">waiting for your decision</td>
            <td className="w-24 px-4 py-2.5 text-right text-subtle">
              <TimeAgo at={session.updatedAt} />
            </td>
            <td className="w-36 px-4 py-1.5 text-right">
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link to="/operator/$sessionId" params={{ sessionId: session.id }} />}
              >
                Review
              </Button>
            </td>
          </>
        ),
      })),
    ...uniqueEvents(events)
      .filter((event) => event.severity !== "info")
      .map((event, index) => ({
        at: event.ts,
        key: `event:${event.pluginId}:${event.ts}:${index}`,
        node: (
          <>
            <td className="w-[38%] truncate px-4 py-2.5">
              <span className="flex items-center gap-2.5">
                <StatusDot tone={event.severity === "error" ? "err" : "warn"} />
                <span className="truncate font-mono">{event.entity?.id ?? event.eventId}</span>
              </span>
            </td>
            <td className="truncate px-4 py-2.5 text-muted-foreground">{event.message ?? event.eventId}</td>
            <td className="w-24 px-4 py-2.5 text-right text-subtle">
              <TimeAgo at={event.ts} />
            </td>
            <td className="w-36" />
          </>
        ),
      })),
  ].sort((a, b) => b.at - a.at)

  return (
    <Section
      title="Activity"
      className="lg:col-span-2"
      aside={
        <>
          <span>alerts, warnings, operator</span>
          <Link to="/alerts" className="text-muted-foreground hover:text-foreground">
            All alerts →
          </Link>
        </>
      }
    >
      {items.length === 0 ? (
        <EmptyRow>
          <span className="flex items-center gap-2">
            <StatusDot tone="ok" /> Quiet: no alerts, warnings, or pending operator decisions.
          </span>
        </EmptyRow>
      ) : (
        <table className="w-full table-fixed text-left text-[13px]">
          <tbody>
            {items.slice(0, 10).map((item) => (
              <tr
                key={item.key}
                className={["border-t border-border first:border-t-0", item.dim ? "opacity-50" : ""].join(
                  " ",
                )}
              >
                {item.node}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

function MachineOverviewPage() {
  const { systemId } = Route.useParams()
  const { detail, metrics: initialMetrics } = Route.useLoaderData()
  useTick(5_000)
  const systemResult = useAtomValue(HubClient.query("systems.get", { id: systemId }))
  const system = lastValue(systemResult, null) ?? detail
  const metricsAtom = HubClient.query("systems.metrics", { id: systemId, range: "1h" })
  useRefreshInterval(metricsAtom)
  const metricsResult = useAtomValue(metricsAtom)
  const samples = Option.getOrElse(AsyncResult.value(metricsResult), () => initialMetrics)
  const latest = samples.at(-1) ?? detail?.latestMetrics ?? null
  const rulesResult = useAtomValue(HubClient.query("alertRules.list", undefined))
  const rules = lastValue(rulesResult, [])
  const alertsResult = useAtomValue(HubClient.query("alerts.list", undefined))
  const alerts = lastValue(alertsResult, [])
  const sessionsResult = useAtomValue(HubClient.query("operator.sessions.list", undefined))
  // The session list is not seeded by the SSR loader; render it only after hydration.
  const hydrated = useHydrated()
  const sessions = hydrated ? lastValue(sessionsResult, []) : []
  const k8sEvents = usePluginEvents(systemId, K8S_PLUGIN_ID, 24)
  const { sessions: terminals, openSession } = useTerminalPanel()

  if (!system) {
    return (
      <Page>
        <PageHeader
          title="Machine not found"
          meta={<span>No machine with id {systemId} has reported to this hub.</span>}
        />
      </Page>
    )
  }

  const online = system.status === "online"
  const otherPlugins = getAvailablePluginCapabilities(system).filter(
    (capability) => capability.pluginId !== SYSTEMD_PLUGIN_ID && capability.pluginId !== K8S_PLUGIN_ID,
  )
  const terminalCount = terminals.filter(
    (terminal) => terminal.kind === "interactive" && terminal.agentId === systemId,
  ).length

  return (
    <Page>
      <PageHeader
        title={
          <>
            <StatusDot tone={online ? "ok" : "off"} className="size-2.5" />
            {system.hostname}
          </>
        }
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={!online}
            onClick={() => openSession({ agentId: systemId, mode: "shell", label: system.hostname })}
          >
            {terminalCount > 0 ? `New terminal (${terminalCount})` : "Open terminal"}
          </Button>
        }
        meta={
          <>
            <span>
              {online ? "Online" : <TimeAgo at={system.lastSeen} prefix="Offline · last seen " />}
              {latest ? ` · up ${formatDuration(latest.uptimeSeconds)}` : ""}
            </span>
            {latest ? (
              <span>
                {latest.cpuCores} cores · {formatBytes(latest.memoryTotalBytes)} RAM
                {latest.diskTotalBytes !== null ? ` · ${formatBytes(latest.diskTotalBytes)} disk` : ""}
              </span>
            ) : null}
            {latest ? (
              <span className="font-mono tabular">
                load {latest.loadAvg1m.toFixed(2)} / {latest.loadAvg5m.toFixed(2)} /{" "}
                {latest.loadAvg15m.toFixed(2)}
              </span>
            ) : null}
            {system.tailscaleIp ? <span className="font-mono">{system.tailscaleIp}</span> : null}
            {latest ? (
              <span className="text-subtle">
                updated <TimeAgo at={latest.timestamp} />
              </span>
            ) : null}
            {otherPlugins.map((capability) => (
              <Link
                key={capability.pluginId}
                to="/systems/$systemId/plugins/$pluginId"
                params={{ systemId, pluginId: capability.pluginId }}
                className="text-subtle hover:text-foreground"
              >
                {capability.pluginId.replace(/^@scout\/plugin-/, "")} →
              </Link>
            ))}
          </>
        }
      />

      {latest ? (
        <HealthStrip systemId={systemId} cells={healthCells(samples, latest, rules)} />
      ) : (
        <Section className="mt-6">
          <EmptyRow>No metrics yet. The agent reports every few seconds once it connects.</EmptyRow>
        </Section>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <ServicesSection systemId={systemId} hostname={system.hostname} system={system} />
        <ClusterSection systemId={systemId} system={system} />
        <IngressSection systemId={systemId} system={system} />
        <BackupsSection systemId={systemId} />
        <ActivitySection systemId={systemId} alerts={alerts} sessions={sessions} events={k8sEvents.items} />
      </div>
    </Page>
  )
}
