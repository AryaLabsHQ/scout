import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import { CheckmarkCircle02Icon, Alert02Icon, InformationCircleIcon } from "@hugeicons/core-free-icons"
import { useScout } from "@/providers/scout-provider"
import { acknowledgeAlert, resolveAlert, fetchAlerts } from "@/server/alerts"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmAction } from "@/components/confirm-action"
import { formatTimeAgo } from "@/lib/format"
import type { Alert } from "@scout/shared"

export const Route = createFileRoute("/alerts")({
  loader: async () => {
    const alerts = await fetchAlerts()
    return { alerts }
  },
  component: AlertsPage,
})

// ── Severity badge ────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: Alert["severity"] }) {
  if (severity === "critical") {
    return (
      <Badge variant="destructive" className="text-[10px] uppercase tracking-wider px-1.5 py-0">
        Critical
      </Badge>
    )
  }
  return (
    <Badge className="text-[10px] uppercase tracking-wider px-1.5 py-0 bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/20">
      Warning
    </Badge>
  )
}

// ── Alert card ────────────────────────────────────────────────────────────────

interface AlertCardProps {
  alert: Alert
  systemHostname: string
  onAck: (id: string) => Promise<void>
  onResolve: (id: string) => Promise<void>
}

function AlertCard({ alert, systemHostname, onAck, onResolve }: AlertCardProps) {
  const isActive = alert.state === "active"
  const isAcknowledged = alert.state === "acknowledged"
  const isResolved = alert.state === "resolved"

  return (
    <Card className={isResolved ? "opacity-60" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {isResolved ? (
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} className="shrink-0 text-green-500" />
            ) : (
              <HugeiconsIcon icon={Alert02Icon} size={14} className={`shrink-0 ${alert.severity === "critical" ? "text-destructive" : "text-yellow-500"}`} />
            )}
            <div className="min-w-0">
              <p className="font-heading text-sm font-semibold truncate">{alert.metric}</p>
              <p className="text-[10px] text-muted-foreground">{systemHostname}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isResolved ? (
              <Badge className="text-[10px] uppercase tracking-wider px-1.5 py-0 bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30 hover:bg-green-500/20">
                Resolved
              </Badge>
            ) : (
              <SeverityBadge severity={alert.severity} />
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Value: <span className="font-medium text-foreground">{alert.value.toFixed(1)}</span></span>
          <span>{formatTimeAgo(alert.triggeredAt)}</span>
        </div>
        {isResolved && alert.resolvedAt && (
          <p className="text-[10px] text-muted-foreground">
            Resolved {formatTimeAgo(alert.resolvedAt)}
          </p>
        )}
        {(isActive || isAcknowledged) && (
          <div className="flex gap-2 pt-1">
            {isActive && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] px-2"
                onClick={() => onAck(alert.id)}
              >
                Acknowledge
              </Button>
            )}
            <ConfirmAction
              title="Resolve Alert"
              description="This will permanently mark the alert as resolved. This action cannot be undone."
              action="Resolve"
              variant="destructive"
              onConfirm={() => onResolve(alert.id)}
            >
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] px-2 text-destructive hover:text-destructive"
              >
                Resolve
              </Button>
            </ConfirmAction>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function AllClear() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={40} className="text-green-500" />
      <p className="font-heading text-sm font-semibold">All clear</p>
      <p className="text-xs text-muted-foreground">No active alerts</p>
    </div>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────

function AlertSection({ title, alerts, systemMap, onAck, onResolve }: {
  title: string
  alerts: Alert[]
  systemMap: Record<string, string>
  onAck: (id: string) => Promise<void>
  onResolve: (id: string) => Promise<void>
}) {
  if (alerts.length === 0) return null
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title} <span className="text-foreground">({alerts.length})</span>
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {alerts.map((alert) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            systemHostname={systemMap[alert.systemId] ?? alert.systemId}
            onAck={onAck}
            onResolve={onResolve}
          />
        ))}
      </div>
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

function AlertsPage() {
  const { alerts: loaderAlerts } = Route.useLoaderData()
  const { alerts: wsAlerts, systems } = useScout()

  // Build system hostname map
  const systemMap: Record<string, string> = {}
  for (const [id, state] of Object.entries(systems)) {
    systemMap[id] = state.system.hostname
  }

  // Merge loader alerts with WS-pushed alerts (WS alerts take precedence by id)
  const [localAlerts, setLocalAlerts] = useState<Alert[]>(loaderAlerts)

  // Merge WS-triggered alerts into local state
  const allAlertsMap = new Map<string, Alert>()
  for (const a of localAlerts) allAlertsMap.set(a.id, a)
  for (const a of wsAlerts) {
    // WS alerts are always the freshest
    allAlertsMap.set(a.id, a)
  }
  const allAlerts = Array.from(allAlertsMap.values()).sort((a, b) => b.triggeredAt - a.triggeredAt)

  const activeAlerts = allAlerts.filter((a) => a.state === "active")
  const acknowledgedAlerts = allAlerts.filter((a) => a.state === "acknowledged")
  const resolvedAlerts = allAlerts.filter((a) => a.state === "resolved")

  const totalActive = activeAlerts.length + acknowledgedAlerts.length

  const handleAck = async (alertId: string) => {
    const updated = await acknowledgeAlert({ data: { alertId } })
    if (updated) {
      setLocalAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, state: "acknowledged" as const, acknowledgedAt: updated.acknowledgedAt } : a))
      )
    }
  }

  const handleResolve = async (alertId: string) => {
    const updated = await resolveAlert({ data: { alertId } })
    if (updated) {
      setLocalAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, state: "resolved" as const, resolvedAt: updated.resolvedAt } : a))
      )
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="font-heading text-base font-semibold">Alerts</h1>
        {totalActive > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-medium text-destructive-foreground">
            {totalActive}
          </span>
        )}
        {totalActive === 0 && allAlerts.length > 0 && (
          <HugeiconsIcon icon={InformationCircleIcon} size={14} className="text-muted-foreground" />
        )}
      </div>

      {/* All clear when no active */}
      {totalActive === 0 && <AllClear />}

      {/* Active section */}
      <AlertSection
        title="Active"
        alerts={activeAlerts}
        systemMap={systemMap}
        onAck={handleAck}
        onResolve={handleResolve}
      />

      {/* Acknowledged section */}
      <AlertSection
        title="Acknowledged"
        alerts={acknowledgedAlerts}
        systemMap={systemMap}
        onAck={handleAck}
        onResolve={handleResolve}
      />

      {/* Resolved section (last 24h) */}
      {resolvedAlerts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Resolved (last 24h) <span className="text-foreground">({resolvedAlerts.length})</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {resolvedAlerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                systemHostname={systemMap[alert.systemId] ?? alert.systemId}
                onAck={handleAck}
                onResolve={handleResolve}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
