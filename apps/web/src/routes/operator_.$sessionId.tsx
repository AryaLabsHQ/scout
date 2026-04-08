import { createFileRoute } from "@tanstack/react-router"
import { OperatorShell } from "@/components/operator/operator-shell"

export const Route = createFileRoute("/operator_/$sessionId")({
  component: OperatorSessionRoute,
})

function OperatorSessionRoute() {
  const { sessionId } = Route.useParams()
  return <OperatorShell variant="page" initialSessionId={sessionId} />
}
