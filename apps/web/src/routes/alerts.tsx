import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/alerts")({ component: AlertsPage })

function AlertsPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
      <p className="text-lg font-medium">Alerts</p>
      <p className="text-sm text-muted-foreground">Coming in M7</p>
    </div>
  )
}
