import type {
  OperatorSessionDetail,
  OperatorSessionEvent,
} from "@scout/shared"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatBypassExpiry } from "./operator-utils"

export function OperatorSessionMeta({
  detail,
  pendingApprovals,
}: {
  detail: OperatorSessionDetail
  pendingApprovals: number
}) {
  const latestSummary =
    detail.planSnapshots.at(-1)?.summary ??
    [...detail.events].reverse().find((event: OperatorSessionEvent) => event.summary)?.summary ??
    detail.session.summary

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
            <div>Pending approvals: {pendingApprovals}</div>
            <div>Model: {detail.session.modelProviderId}/{detail.session.modelId}</div>
            <div>
              Bypass mode:{" "}
              {detail.session.bypassMode === "timed_override"
                ? `enabled until ${formatBypassExpiry(detail.session.bypassExpiresAt)}`
                : "off"}
            </div>
            {detail.session.parentSessionId ? (
              <div>Parent session: {detail.session.parentSessionId}</div>
            ) : null}
            {detail.session.forkedFromEntryId ? (
              <div>Forked from entry: {detail.session.forkedFromEntryId}</div>
            ) : null}
            {detail.session.currentLeafEntryId ? (
              <div>Current leaf: {detail.session.currentLeafEntryId}</div>
            ) : null}
            <div>Last event seq: {detail.session.lastEventSeq}</div>
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

      <Card size="sm">
        <CardHeader>
          <CardTitle>Latest Summary</CardTitle>
          <CardDescription>Durable summary placeholder for the final operator write-up.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">{latestSummary ?? "No summary yet."}</p>
        </CardContent>
      </Card>
    </>
  )
}
