import type { OperatorSessionDetail } from "@scout/shared"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function OperatorSessionMeta({
  detail,
  pendingApprovals,
}: {
  detail: OperatorSessionDetail
  pendingApprovals: number
}) {
  return (
    <>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Scope</CardTitle>
          <CardDescription>
            Explicit node scope and approval posture for this operator session.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {detail.session.selectedNodeIds.length === 0 ? (
              <Badge variant="outline">No nodes selected yet</Badge>
            ) : (
              detail.session.selectedNodeIds.map((nodeId) => (
                <Badge key={nodeId} variant="outline">
                  {nodeId}
                </Badge>
              ))
            )}
          </div>
          <div className="grid gap-2 text-[11px] text-muted-foreground">
            <div>Approval mode: {detail.session.approvalMode}</div>
            <div>Mode: {detail.session.planMode === "plan_first" ? "Plan — observe and propose before acting" : "Build — execute tools directly"}</div>
            <div>Pending approvals: {pendingApprovals}</div>
            <div>Model: {detail.session.modelProviderId}/{detail.session.modelId}</div>
            {detail.session.parentSessionId ? (
              <div>Parent session: {detail.session.parentSessionId}</div>
            ) : null}
            {detail.session.forkedFromEntryId ? (
              <div>Forked from entry: {detail.session.forkedFromEntryId}</div>
            ) : null}
            {detail.queuedInputs > 0 ? <div>Queued inputs: {detail.queuedInputs}</div> : null}
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Skills</CardTitle>
          <CardDescription>Skills attached to this session for future operator turns.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {detail.session.attachedSkillIds.length === 0 ? (
              <Badge variant="outline">No skills attached</Badge>
            ) : (
              detail.session.attachedSkillIds.map((skillId) => (
                <Badge key={skillId} variant="outline">
                  {detail.availableSkills.find((skill) => skill.id === skillId)?.name ?? skillId}
                </Badge>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </>
  )
}
