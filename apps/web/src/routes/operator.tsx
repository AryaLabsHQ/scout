import { createFileRoute } from "@tanstack/react-router"
import { OperatorShell } from "@/components/operator/operator-shell"

export const Route = createFileRoute("/operator")({
  component: OperatorRoute,
})

function OperatorRoute() {
  return <OperatorShell variant="page" />
}
