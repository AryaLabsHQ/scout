import { useEffect, useState } from "react"
import { lastValue } from "@/lib/async-result"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import {
  SYSTEMD_ACTION_IDS,
  SYSTEMD_METRIC_IDS,
  SYSTEMD_PLUGIN_ID,
  SYSTEMD_SERVICE_KINDS,
  SYSTEMD_STREAM_IDS,
  SYSTEMD_UNIT_KIND,
} from "@scout/plugin-systemd/contracts"
import { HubClient } from "@/rpc/client"
import { fetchSystemDetail } from "@/server/systems"
import { usePins } from "@/hooks/use-pins"
import { usePluginEntities, usePluginMetrics } from "@/hooks/use-plugin-data"
import { useUnitAction } from "@/hooks/use-unit-action"
import { Button } from "@/components/ui/button"
import { LogViewer } from "@/components/log-viewer"
import { EmptyRow, Page, PageHeader, Section } from "@/components/section"
import { Sparkline } from "@/components/sparkline"
import { StatusDot } from "@/components/status-dot"
import { TimeUntil } from "@/components/time-ago"
import { PinButton, UnitActionsMenu } from "@/components/units-table"
import { pluginUnavailable } from "@/components/plugin-status"
import { formatBytes, formatDuration, formatTimeAgo } from "@/lib/format"
import {
  isTimerEntity,
  pinKey,
  shortUnitName,
  timerState,
  unitState,
  unitTone,
  type SystemdScope,
} from "@/lib/systemd"
import { cn } from "@/lib/utils"

const TABS = ["overview", "journal", "unit file"] as const
type Tab = (typeof TABS)[number]

interface UnitSearch {
  readonly tab?: Tab
  /** `user` for a unit of the agent user's manager; absent for system units. */
  readonly scope?: "user"
}

export const Route = createFileRoute("/systems_/$systemId/services_/$unitId")({
  validateSearch: (search: Record<string, unknown>): UnitSearch => ({
    ...(TABS.includes(search["tab"] as Tab) && search["tab"] !== "overview" ? { tab: search["tab"] as Tab } : {}),
    ...(search["scope"] === "user" ? { scope: "user" as const } : {}),
  }),
  loader: async ({ params }) => ({ detail: await fetchSystemDetail({ data: { systemId: params.systemId } }) }),
  component: UnitPage,
})

/** CPU use between consecutive cumulative `unit.cpu.usage.ns` samples, as % of one core. */
function cpuRates(points: ReadonlyArray<{ readonly ts: number; readonly value: number }>): number[] {
  const rates: number[] = []
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!
    const current = points[index]!
    const elapsedNs = (current.ts - previous.ts) * 1e6
    if (elapsedNs > 0 && current.value >= previous.value) rates.push(((current.value - previous.value) / elapsedNs) * 100)
  }
  return rates
}

function UnitFile({ systemId, unitId, scope }: { systemId: string; unitId: string; scope: SystemdScope }) {
  const runAction = useAtomSet(HubClient.mutation("plugins.runAction"), { mode: "promise" })
  const [file, setFile] = useState<{ path: string; content: string } | { error: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    setFile(null)
    // Reading the unit file changes nothing, so it runs without a confirm.
    runAction({
      payload: {
        agentId: systemId,
        pluginId: SYSTEMD_PLUGIN_ID,
        actionId: SYSTEMD_ACTION_IDS.readUnitFile,
        entity: { pluginId: SYSTEMD_PLUGIN_ID, kind: SYSTEMD_SERVICE_KINDS[scope], id: unitId },
      },
    })
      .then((result) => {
        if (cancelled) return
        const output = result.output as { path?: unknown; content?: unknown } | undefined
        if (result.success && typeof output?.content === "string") {
          setFile({ path: typeof output.path === "string" ? output.path : unitId, content: output.content })
        } else {
          setFile({ error: result.summary ?? "The agent could not read this unit file." })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setFile({ error: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      cancelled = true
    }
  }, [runAction, scope, systemId, unitId])

  return (
    <Section
      className="mt-6"
      title={<span className="font-mono text-[13px]">{file && "path" in file ? file.path : unitId}</span>}
      aside={<span>read-only</span>}
    >
      {file === null ? (
        <EmptyRow>Reading the unit file…</EmptyRow>
      ) : "error" in file ? (
        <EmptyRow>{file.error}</EmptyRow>
      ) : (
        <pre className="max-h-[560px] overflow-auto px-4 py-3 font-mono text-xs leading-relaxed scrollbar-thin">
          {file.content}
        </pre>
      )}
    </Section>
  )
}

function UnitPage() {
  const { systemId, unitId } = Route.useParams()
  const { tab = "overview", scope = "system" } = Route.useSearch()
  const { detail } = Route.useLoaderData()
  const systemResult = useAtomValue(HubClient.query("systems.get", { id: systemId }))
  const system = lastValue(systemResult, null) ?? detail
  const hostname = system?.hostname ?? systemId
  const entities = usePluginEntities(systemId, SYSTEMD_PLUGIN_ID)
  const kind = SYSTEMD_SERVICE_KINDS[scope]
  const memory = usePluginMetrics(systemId, SYSTEMD_PLUGIN_ID, 1, SYSTEMD_METRIC_IDS.unitMemoryBytes)
  const cpu = usePluginMetrics(systemId, SYSTEMD_PLUGIN_ID, 1, SYSTEMD_METRIC_IDS.unitCpuUsageNs)
  const { isPinned, toggle } = usePins(systemId)
  const { run } = useUnitAction(systemId, hostname)
  const unavailable = pluginUnavailable(system, SYSTEMD_PLUGIN_ID, "systemd")

  const unit = entities.items.find((entity) => entity.ref.kind === kind && entity.ref.id === unitId) ?? null
  const state = unit ? unitState(unit) : null
  // The timer that starts this unit, if any (restic-backup.timer → restic-backup.service).
  const timer =
    entities.items.find(
      (entity) => isTimerEntity(entity) && timerState(entity).scope === scope && timerState(entity).activates === unitId,
    ) ?? null
  const forUnit = (point: { readonly entity?: { readonly kind: string; readonly id: string } }) =>
    point.entity?.kind === kind && point.entity.id === unitId
  const memorySeries = memory.items.filter(forUnit).sort((a, b) => a.ts - b.ts)
  const cpuSeries = cpuRates(cpu.items.filter(forUnit).sort((a, b) => a.ts - b.ts))

  const crumbs = (
    <>
      <Link to="/systems/$systemId" params={{ systemId }} className="hover:text-foreground">
        {hostname}
      </Link>
      <span>/</span>
      <Link to="/systems/$systemId/services" params={{ systemId }} className="hover:text-foreground">
        Services
      </Link>
      <span>/</span>
      <span className="truncate">{unitId}</span>
      {scope === "user" ? <span className="text-subtle">· user</span> : null}
    </>
  )

  if (unavailable || (!unit && !entities.loading)) {
    return (
      <Page>
        <PageHeader crumbs={crumbs} title={<span className="font-mono">{unitId}</span>} />
        <Section className="mt-6">
          {unavailable ?? (
            <EmptyRow>
              {hostname} does not report a {scope === "user" ? "user " : ""}unit named {unitId}.
            </EmptyRow>
          )}
        </Section>
      </Page>
    )
  }

  const key = pinKey(scope, unitId)
  const pinned = isPinned(key)
  const lastExit =
    state?.execMainExitAt != null
      ? `${state.execMainStatus !== null ? `status ${state.execMainStatus} · ` : ""}${formatTimeAgo(state.execMainExitAt)}`
      : "—"
  const timerInfo = timer ? timerState(timer) : null
  const properties: ReadonlyArray<readonly [string, React.ReactNode, string?]> = state
    ? [
        ["Description", state.description || "—"],
        ["Manager", scope === "user" ? "user (systemctl --user)" : "system"],
        ["Load state", state.loadState || "—"],
        ["Unit file state", state.unitFileState ?? "—"],
        ["Active state", `${state.activeState || "—"}${state.subState ? ` · ${state.subState}` : ""}`],
        ["Active since", state.activeEnterAt !== null ? formatTimeAgo(state.activeEnterAt) : "—"],
        ["Result", state.result ?? "—"],
        ["Last exit", lastExit],
        ["Restarts", state.restarts !== null ? String(state.restarts) : "—"],
        ["Main PID", state.pid !== null && state.pid > 0 ? String(state.pid) : "—"],
        ...(timer && timerInfo
          ? [
              [
                "Timer",
                <>
                  {shortUnitName(timer.ref.id)}
                  {timerInfo.nextRunAt !== null ? <TimeUntil at={timerInfo.nextRunAt} prefix=" · next " /> : " · not scheduled"}
                </>,
                timer.ref.id,
              ] as const,
            ]
          : []),
        ["Last reported", unit ? formatTimeAgo(unit.ts) : "—"],
      ]
    : []

  return (
    <Page>
      <PageHeader
        crumbs={crumbs}
        title={
          <>
            <StatusDot tone={state ? unitTone(state) : "off"} className="size-2.5" />
            <span className="truncate font-mono">{unitId}</span>
          </>
        }
        actions={
          <>
            <PinButton pinned={pinned} onToggle={() => toggle(key)} />
            <Button size="sm" variant="outline" onClick={() => void run("restart", unitId, scope)}>
              Restart
            </Button>
            <Button size="sm" variant="outline" onClick={() => void run("stop", unitId, scope)}>
              Stop
            </Button>
            <UnitActionsMenu
              unitId={unitId}
              pinned={pinned}
              onAction={(action) => void run(action, unitId, scope)}
              onTogglePin={() => toggle(key)}
            />
          </>
        }
        meta={
          state ? (
            <>
              <span>
                {state.activeState} · {state.subState}
              </span>
              {state.pid !== null && state.pid > 0 ? <span className="font-mono tabular">pid {state.pid}</span> : null}
              {state.activeState === "active" && state.activeEnterAt !== null ? (
                <span>since {formatDuration((Date.now() - state.activeEnterAt) / 1000)}</span>
              ) : null}
              {scope === "user" ? <span>user unit</span> : null}
              <span className="text-subtle">{state.description}</span>
            </>
          ) : (
            <span>Loading…</span>
          )
        }
      />

      <div className="mt-6 flex gap-6 border-b border-border">
        {TABS.filter((value) => scope === "system" || value !== "journal").map((value) => (
          <Link
            key={value}
            to="/systems/$systemId/services/$unitId"
            params={{ systemId, unitId }}
            search={{ ...(value === "overview" ? {} : { tab: value }), ...(scope === "user" ? { scope } : {}) }}
            className={cn(
              "-mb-px border-b px-0.5 py-2.5 text-[13px] capitalize",
              value === tab ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {value}
          </Link>
        ))}
      </div>

      {tab === "unit file" ? (
        <UnitFile systemId={systemId} unitId={unitId} scope={scope} />
      ) : (
        <>
          {tab === "overview" && state ? (
            <>
              <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-lg border border-border lg:grid-cols-4">
                {[
                  {
                    label: "Memory",
                    value: state.memoryBytes !== null ? formatBytes(state.memoryBytes) : "—",
                    sub: memorySeries.length > 1 ? "1h" : "",
                    series: memorySeries.map((point) => point.value),
                  },
                  {
                    label: "CPU",
                    value: cpuSeries.length > 0 ? `${cpuSeries.at(-1)!.toFixed(1)}%` : "—",
                    sub: state.cpuUsageNs !== null ? `${formatDuration(state.cpuUsageNs / 1e9)} total` : "",
                    series: cpuSeries,
                  },
                  {
                    label: "Restarts",
                    value: state.restarts !== null ? String(state.restarts) : "—",
                    sub: state.result && state.result !== "success" ? `last result ${state.result}` : "",
                    series: [],
                  },
                  { label: "State", value: state.subState || state.activeState, sub: state.activeState, series: [] },
                ].map((cell, index) => (
                  <div
                    key={cell.label}
                    className={cn(
                      "min-w-0 px-5 py-4",
                      index % 2 === 1 && "border-l border-border",
                      index >= 2 && "border-t border-border lg:border-t-0",
                      index === 2 && "lg:border-l",
                    )}
                  >
                    <div className="text-[12.5px] text-muted-foreground">{cell.label}</div>
                    <div className="mt-1.5 flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[22px] font-medium tracking-tight tabular">{cell.value}</div>
                        <div className="mt-0.5 text-xs text-subtle">{cell.sub}</div>
                      </div>
                      <Sparkline values={cell.series} className="hidden sm:block" />
                    </div>
                  </div>
                ))}
              </div>

              <Section className="mt-6" title="Properties">
                <dl className="grid sm:grid-cols-2">
                  {properties.map(([label, value, title], index) => (
                    <div
                      key={label}
                      className={cn(
                        "flex justify-between gap-4 border-border px-4 py-2.5 text-[13px]",
                        index >= 2 && "border-t",
                        index === 1 && "max-sm:border-t",
                        index % 2 === 1 && "sm:border-l",
                      )}
                    >
                      <dt className="text-subtle">{label}</dt>
                      <dd
                        className="truncate text-right font-mono text-[12.5px]"
                        title={title ?? (typeof value === "string" ? value : undefined)}
                      >
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Section>
            </>
          ) : null}

          {scope === "user" ? (
            <Section className="mt-6" title="Journal">
              <EmptyRow>
                Scout streams the journal of system units only. For this user unit, run{" "}
                <span className="font-mono text-foreground">journalctl --user -u {unitId}</span> in a terminal.
              </EmptyRow>
            </Section>
          ) : (
          <Section className="mt-6" title="Journal">
            <div className={tab === "journal" ? "h-[640px]" : "h-[420px]"}>
              <LogViewer
                title={`journalctl -u ${unitId}`}
                params={{
                  agentId: systemId,
                  pluginId: SYSTEMD_PLUGIN_ID,
                  streamId: SYSTEMD_STREAM_IDS.unitLogs,
                  entity: { pluginId: SYSTEMD_PLUGIN_ID, kind: SYSTEMD_UNIT_KIND, id: unitId },
                  input: { tail: 200 },
                }}
              />
            </div>
          </Section>
          )}
        </>
      )}
    </Page>
  )
}
