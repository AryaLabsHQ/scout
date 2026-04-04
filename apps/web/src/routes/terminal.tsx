import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/terminal")({ component: TerminalPage })

function TerminalPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
      <p className="text-lg font-medium">Terminal</p>
      <p className="text-sm text-muted-foreground">Coming in M6</p>
    </div>
  )
}
