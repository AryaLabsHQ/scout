import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/settings")({ component: SettingsPage })

function SettingsPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
      <p className="text-lg font-medium">Settings</p>
      <p className="text-sm text-muted-foreground">Coming in M8</p>
    </div>
  )
}
