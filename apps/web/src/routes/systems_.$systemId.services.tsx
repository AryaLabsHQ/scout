import { useMemo } from "react"
import { lastValue } from "@/lib/async-result"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useAtomValue } from "@effect/atom-react"
import { SYSTEMD_PLUGIN_ID, SYSTEMD_UNIT_KIND } from "@scout/plugin-systemd/contracts"
import { HubClient } from "@/rpc/client"
import { fetchSystemDetail } from "@/server/systems"
import { usePins } from "@/hooks/use-pins"
import { usePluginEntities } from "@/hooks/use-plugin-data"
import { useUnitAction } from "@/hooks/use-unit-action"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyRow, Page, PageHeader, Section } from "@/components/section"
import { UnitsTable } from "@/components/units-table"
import { pluginUnavailable } from "@/components/plugin-status"
import { unitState } from "@/lib/systemd"
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

function ServicesPage() {
  const { systemId } = Route.useParams()
  const { q = "", state: filter = "all" } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { detail } = Route.useLoaderData()
  const systemResult = useAtomValue(HubClient.query("systems.get", { id: systemId }))
  const system = lastValue(systemResult, null) ?? detail
  const hostname = system?.hostname ?? systemId
  const units = usePluginEntities(systemId, SYSTEMD_PLUGIN_ID, SYSTEMD_UNIT_KIND)
  const { pins, isPinned, toggle } = usePins(systemId)
  const { run, daemonReload } = useUnitAction(systemId, hostname)
  const unavailable = pluginUnavailable(system, SYSTEMD_PLUGIN_ID, "systemd")

  const counts = useMemo(() => {
    const states = units.items.map((unit) => unitState(unit).activeState)
    return {
      all: states.length,
      failed: states.filter((state) => state === "failed").length,
      active: states.filter((state) => state === "active").length,
      inactive: states.filter((state) => state === "inactive").length,
      pinned: units.items.filter((unit) => pins.includes(unit.ref.id)).length,
    } satisfies Record<Filter, number>
  }, [pins, units.items])

  const rows = useMemo(() => {
    const needle = q.toLowerCase()
    return units.items
      .filter((unit) => {
        const state = unitState(unit)
        if (filter === "pinned" && !pins.includes(unit.ref.id)) return false
        if (filter !== "all" && filter !== "pinned" && state.activeState !== filter) return false
        return needle.length === 0 || `${unit.ref.id} ${state.description}`.toLowerCase().includes(needle)
      })
      .sort(
        (a, b) =>
          Number(unitState(b).activeState === "failed") - Number(unitState(a).activeState === "failed") ||
          Number(pins.includes(b.ref.id)) - Number(pins.includes(a.ref.id)) ||
          a.ref.id.localeCompare(b.ref.id),
      )
  }, [filter, pins, q, units.items])

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
        meta={<span>systemd system units on {hostname} · ☆ pins a unit to the overview (stored in this browser)</span>}
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
          (units.loading ? (
            <EmptyRow>Loading units…</EmptyRow>
          ) : rows.length === 0 ? (
            <EmptyRow>{units.items.length === 0 ? "No units reported yet." : "No units match this filter."}</EmptyRow>
          ) : (
            <UnitsTable
              systemId={systemId}
              units={rows}
              isPinned={isPinned}
              onTogglePin={toggle}
              onAction={run}
              showHeader
            />
          ))}
      </Section>
    </Page>
  )
}
