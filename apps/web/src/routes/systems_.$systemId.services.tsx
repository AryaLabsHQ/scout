import { useMemo } from "react"
import { lastValue } from "@/lib/async-result"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useAtomValue } from "@effect/atom-react"
import type { EntitySnapshot } from "@scout/plugin-sdk"
import { SYSTEMD_PLUGIN_ID } from "@scout/plugin-systemd/contracts"
import { HubClient } from "@/rpc/client"
import { fetchSystemDetail } from "@/server/systems"
import { usePins } from "@/hooks/use-pins"
import { usePluginEntities } from "@/hooks/use-plugin-data"
import { useUnitAction } from "@/hooks/use-unit-action"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyRow, GroupLabel, Page, PageHeader, Section } from "@/components/section"
import { TimersTable } from "@/components/timers-table"
import { UnitsTable } from "@/components/units-table"
import { pluginUnavailable } from "@/components/plugin-status"
import {
  byTimerPriority,
  isServiceEntity,
  isTimerEntity,
  pinKey,
  timerFailed,
  timerState,
  unitState,
} from "@/lib/systemd"
import { cn } from "@/lib/utils"

const FILTERS = ["all", "failed", "active", "inactive", "pinned"] as const
type Filter = (typeof FILTERS)[number]

interface ServicesSearch {
  readonly q?: string
  readonly state?: Filter
}

export const Route = createFileRoute("/systems_/$systemId/services")({
  validateSearch: (search: Record<string, unknown>): ServicesSearch => ({
    ...(typeof search["q"] === "string" && search["q"].length > 0 ? { q: search["q"] } : {}),
    ...(FILTERS.includes(search["state"] as Filter) ? { state: search["state"] as Filter } : {}),
  }),
  loader: async ({ params }) => ({ detail: await fetchSystemDetail({ data: { systemId: params.systemId } }) }),
  component: ServicesPage,
})

const isUnitPinned = (pins: ReadonlyArray<string>, unit: EntitySnapshot): boolean =>
  pins.includes(pinKey(unitState(unit).scope, unit.ref.id))

function ServicesPage() {
  const { systemId } = Route.useParams()
  const { q = "", state: filter = "all" } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { detail } = Route.useLoaderData()
  const systemResult = useAtomValue(HubClient.query("systems.get", { id: systemId }))
  const system = lastValue(systemResult, null) ?? detail
  const hostname = system?.hostname ?? systemId
  const entities = usePluginEntities(systemId, SYSTEMD_PLUGIN_ID)
  const units = useMemo(() => entities.items.filter(isServiceEntity), [entities.items])
  const timers = useMemo(() => entities.items.filter(isTimerEntity), [entities.items])
  const { pins, isPinned, toggle } = usePins(systemId)
  const { run, daemonReload } = useUnitAction(systemId, hostname)
  const unavailable = pluginUnavailable(system, SYSTEMD_PLUGIN_ID, "systemd")

  // Each chip counts what its filter shows: units, plus timers for every
  // filter but "pinned" (a timer counts as failed when its last run failed).
  const counts = useMemo(() => {
    const unitStates = units.map((unit) => unitState(unit).activeState)
    const timerStates = timers.map(timerState)
    const byState = (state: string) =>
      unitStates.filter((value) => value === state).length +
      timerStates.filter((timer) => timer.activeState === state).length
    return {
      all: units.length + timers.length,
      failed: unitStates.filter((state) => state === "failed").length + timerStates.filter(timerFailed).length,
      active: byState("active"),
      inactive: byState("inactive"),
      pinned: units.filter((unit) => isUnitPinned(pins, unit)).length,
    } satisfies Record<Filter, number>
  }, [pins, timers, units])

  const rows = useMemo(() => {
    const needle = q.toLowerCase()
    return units
      .filter((unit) => {
        const state = unitState(unit)
        if (filter === "pinned" && !isUnitPinned(pins, unit)) return false
        if (filter !== "all" && filter !== "pinned" && state.activeState !== filter) return false
        return needle.length === 0 || `${unit.ref.id} ${state.description}`.toLowerCase().includes(needle)
      })
      .sort(
        (a, b) =>
          Number(unitState(b).activeState === "failed") - Number(unitState(a).activeState === "failed") ||
          Number(isUnitPinned(pins, b)) - Number(isUnitPinned(pins, a)) ||
          a.ref.id.localeCompare(b.ref.id),
      )
  }, [filter, pins, q, units])
  const systemRows = rows.filter((unit) => unitState(unit).scope === "system")
  const userRows = rows.filter((unit) => unitState(unit).scope === "user")

  // Timers follow the text filter, and the failed / active / inactive chips by
  // their own state; pins are for units only.
  const timerRows = useMemo(() => {
    const needle = q.toLowerCase()
    return timers
      .filter((timer) => {
        const state = timerState(timer)
        if (filter === "pinned") return false
        if (filter === "failed" && !timerFailed(state)) return false
        if ((filter === "active" || filter === "inactive") && state.activeState !== filter) return false
        return needle.length === 0 || `${timer.ref.id} ${state.activates} ${state.description}`.toLowerCase().includes(needle)
      })
      .sort(byTimerPriority)
  }, [filter, q, timers])

  const unitGroup = (label: string, aside: string, group: typeof rows, empty: string) => (
    <>
      <GroupLabel aside={<span className="tabular">{aside}</span>}>{label}</GroupLabel>
      {group.length > 0 ? (
        <UnitsTable
          systemId={systemId}
          units={group}
          isPinned={isPinned}
          onTogglePin={toggle}
          onAction={run}
          showHeader
        />
      ) : (
        <EmptyRow>{empty}</EmptyRow>
      )}
    </>
  )

  const setSearch = (next: ServicesSearch) =>
    void navigate({ search: (previous: ServicesSearch) => ({ ...previous, ...next }), replace: true })

  return (
    <Page>
      <PageHeader
        crumbs={
          <>
            <Link to="/systems/$systemId" params={{ systemId }} className="hover:text-foreground">
              {hostname}
            </Link>
            <span>/</span>
            <span>Services</span>
          </>
        }
        title="Services"
        meta={
          <span>
            systemd system and user units, and timers, on {hostname} · ☆ pins a unit to the overview (stored in this
            browser)
          </span>
        }
        actions={
          <Button size="sm" variant="outline" onClick={() => void daemonReload()} disabled={unavailable !== null}>
            Reload systemd
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Input
          defaultValue={q}
          placeholder="Filter units…"
          className="h-8 w-72"
          onChange={(event) => setSearch({ q: event.target.value || undefined })}
        />
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSearch({ state: value === "all" ? undefined : value })}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12.5px] capitalize",
                value === filter
                  ? "border-border-strong bg-muted text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {value}
              <span className={cn("font-mono tabular", value === "failed" && counts.failed > 0 ? "text-err" : "text-subtle")}>
                {counts[value]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Section className="mt-4">
        {unavailable ??
          (entities.loading ? (
            <EmptyRow>Loading units…</EmptyRow>
          ) : units.length === 0 ? (
            <EmptyRow>No units reported yet.</EmptyRow>
          ) : (
            <>
              {unitGroup("SYSTEM · systemctl", String(systemRows.length), systemRows, "No system units match this filter.")}
              {units.some((unit) => unitState(unit).scope === "user")
                ? unitGroup(
                    "USER · systemctl --user",
                    String(userRows.length),
                    userRows,
                    "No user units match this filter.",
                  )
                : null}
            </>
          ))}
      </Section>

      {unavailable === null && timers.length > 0 ? (
        <Section id="timers" className="mt-6" title="Timers" aside={<span>next and last run of each timer</span>}>
          {timerRows.length > 0 ? (
            <TimersTable systemId={systemId} timers={timerRows} />
          ) : (
            <EmptyRow>No timers match this filter.</EmptyRow>
          )}
        </Section>
      ) : null}
    </Page>
  )
}
