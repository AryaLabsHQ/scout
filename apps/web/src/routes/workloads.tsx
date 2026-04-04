import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/workloads")({ component: WorkloadsPage })

function WorkloadsPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
      <p className="text-lg font-medium">Workloads</p>
      <p className="text-sm text-muted-foreground">Coming in M4</p>
    </div>
  )
}
