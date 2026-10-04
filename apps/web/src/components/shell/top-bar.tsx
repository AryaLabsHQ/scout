import { Link, useRouterState } from "@tanstack/react-router"
import { useAtomValue } from "@effect/atom-react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, Settings01Icon } from "@hugeicons/core-free-icons"
import type { System } from "@scout/shared"
import { HubClient } from "@/rpc/client"
import { lastValue } from "@/lib/async-result"
import { useOperator } from "@/providers/operator-provider"
import { useCommandPalette } from "@/providers/command-palette-provider"
import { bySystemOrder, useCurrentSystem } from "@/hooks/use-current-system"
import { useHydrated } from "@/hooks/use-hydrated"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { StatusDot } from "@/components/status-dot"
import { cn } from "@/lib/utils"
import { LiveIndicator } from "./connection"

const navLinkClass = (active: boolean) =>
  cn(
    "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors",
    active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-raised hover:text-foreground",
  )

function Count({ value, tone }: { value: number; tone: "err" | "warn" }) {
  if (value === 0) return null
  return (
    <span className={cn("font-mono text-[11px] tabular", tone === "err" ? "text-err" : "text-warn")}>
      {value}
    </span>
  )
}

function MachineSwitcher({ systems, current }: { systems: ReadonlyArray<System>; current: System | null }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-sm font-medium hover:bg-raised"
          />
        }
      >
        {current ? (
          <>
            <StatusDot tone={current.status === "online" ? "ok" : "off"} />
            {current.hostname}
          </>
        ) : (
          <span className="text-muted-foreground">No machines</span>
        )}
        <HugeiconsIcon icon={ArrowDown01Icon} size={14} className="text-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Machines</DropdownMenuLabel>
          {[...systems].sort(bySystemOrder).map((system) => (
            <DropdownMenuItem
              key={system.id}
              render={<Link to="/systems/$systemId" params={{ systemId: system.id }} />}
            >
              <StatusDot tone={system.status === "online" ? "ok" : "off"} />
              <span className="truncate">{system.hostname}</span>
              {system.id === current?.id ? (
                <span className="ml-auto text-xs text-subtle">current</span>
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/" />}>All machines</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The app's only navigation: wordmark, machine switcher, machine-scoped links
 * (Overview, Services, Cluster), global links (Alerts, Operator, Terminal), and
 * the live indicator, command menu, settings, and operator drawer on the right.
 */
export function TopBar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { systems, current } = useCurrentSystem()
  const { openDrawer } = useOperator()
  const { open: openPalette } = useCommandPalette()
  const alertsResult = useAtomValue(HubClient.query("alerts.list", undefined))
  const sessionsResult = useAtomValue(HubClient.query("operator.sessions.list", undefined))
  const hydrated = useHydrated()
  const activeAlerts = lastValue(alertsResult, []).filter((alert) => alert.state === "active").length
  // Not seeded by the SSR loader; count only after hydration so the markup matches.
  const waitingSessions = hydrated
    ? lastValue(sessionsResult, []).filter((session) => session.status === "waiting_for_user").length
    : 0

  const systemBase = current ? `/systems/${encodeURIComponent(current.id)}` : null
  const isOverview = systemBase !== null && (pathname === systemBase || pathname === `${systemBase}/metrics`)
  const isServices = systemBase !== null && pathname.startsWith(`${systemBase}/services`)
  const isCluster = systemBase !== null && pathname.startsWith(`${systemBase}/cluster`)

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:px-5">
      <Link to="/" className="text-[15px] font-semibold tracking-tight">
        Scout
      </Link>
      <span className="text-xl font-light text-border-strong" aria-hidden>
        /
      </span>
      <MachineSwitcher systems={systems} current={current} />

      <nav className="ml-2 hidden items-center gap-0.5 md:flex" aria-label="Main">
        {current ? (
          <>
            <Link
              to="/systems/$systemId"
              params={{ systemId: current.id }}
              className={navLinkClass(isOverview)}
            >
              Overview
            </Link>
            <Link
              to="/systems/$systemId/services"
              params={{ systemId: current.id }}
              className={navLinkClass(isServices)}
            >
              Services
            </Link>
            <Link
              to="/systems/$systemId/cluster"
              params={{ systemId: current.id }}
              className={navLinkClass(isCluster)}
            >
              Cluster
            </Link>
          </>
        ) : null}
        <Link to="/alerts" className={navLinkClass(pathname.startsWith("/alerts"))}>
          Alerts
          <Count value={activeAlerts} tone="err" />
        </Link>
        <Link to="/operator" className={navLinkClass(pathname.startsWith("/operator"))}>
          Operator
          <Count value={waitingSessions} tone="warn" />
        </Link>
        <Link to="/terminal" className={navLinkClass(pathname.startsWith("/terminal"))}>
          Terminal
        </Link>
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <LiveIndicator />
        <button
          type="button"
          onClick={openPalette}
          className="hidden rounded border border-border-strong px-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground sm:inline"
          aria-label="Open command menu"
        >
          ⌘K
        </button>
        <Link
          to="/settings"
          className={cn(
            "inline-grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-raised hover:text-foreground",
            pathname.startsWith("/settings") && "bg-muted text-foreground",
          )}
          aria-label="Settings"
        >
          <HugeiconsIcon icon={Settings01Icon} size={16} />
        </Link>
        <Button size="sm" variant="outline" onClick={() => openDrawer()}>
          Ask operator
        </Button>
      </div>
    </header>
  )
}
