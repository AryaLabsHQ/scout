import { Link } from "@tanstack/react-router"
import { lastValue } from "@/lib/async-result"
import { useAtomValue } from "@effect/atom-react"
import type { OperatorSessionDetail } from "@scout/shared"
import { HubClient } from "@/rpc/client"
import { StatusDot } from "@/components/status-dot"
import { cn } from "@/lib/utils"
import { APPROVAL_MODE_LABEL, SESSION_STATUS } from "./operator-utils"

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right">{children}</span>
    </div>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-1.5 text-xs text-subtle">{children}</h4>
}

export function OperatorSessionMeta({
  detail,
  pendingApprovals,
}: {
  detail: OperatorSessionDetail
  pendingApprovals: number
}) {
  const sessionsResult = useAtomValue(HubClient.query("operator.sessions.list", undefined))
  const session = detail.session
  const listed = lastValue(sessionsResult, [])
  // A session created moments ago may not be in the cached list yet.
  const sessions = listed.some((summary) => summary.id === session.id) ? listed : [session, ...listed]

  return (
    <>
      <div>
        <Heading>Sessions</Heading>
        <div className="space-y-0.5">
          {sessions.slice(0, 8).map((summary) => (
            <Link
              key={summary.id}
              to="/operator/$sessionId"
              params={{ sessionId: summary.id }}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px]",
                summary.id === session.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-raised hover:text-foreground",
              )}
            >
              <StatusDot tone={SESSION_STATUS[summary.status].tone} />
              <span className="truncate">{summary.title}</span>
            </Link>
          ))}
          <Link to="/operator" className="block px-2 py-1.5 text-[13px] text-subtle hover:text-foreground">
            All sessions →
          </Link>
        </div>
      </div>

      <div>
        <Heading>Scope</Heading>
        <Row label="Machines">
          <span className="font-mono">
            {session.selectedNodeIds.length === 0 ? "none selected" : session.selectedNodeIds.join(", ")}
          </span>
        </Row>
        <Row label="Approvals">{APPROVAL_MODE_LABEL[session.approvalMode]}</Row>
        <Row label="Pending">
          <span className={pendingApprovals > 0 ? "text-warn" : undefined}>{pendingApprovals}</span>
        </Row>
        <Row label="Mode">{session.planMode === "plan_first" ? "Plan first" : "Build"}</Row>
        <Row label="Model">
          <span className="font-mono" title="The model is fixed per session; switching is not supported yet">
            {session.modelProviderId}/{session.modelId}
          </span>
        </Row>
        {detail.queuedInputs > 0 ? <Row label="Queued prompts">{detail.queuedInputs}</Row> : null}
        {session.parentSessionId ? (
          <Row label="Forked from">
            <Link
              to="/operator/$sessionId"
              params={{ sessionId: session.parentSessionId }}
              className="font-mono hover:underline"
            >
              {session.parentSessionId}
            </Link>
          </Row>
        ) : null}
      </div>

      <div>
        <Heading>Skills</Heading>
        {session.attachedSkillIds.length === 0 ? (
          <p className="text-[13px] text-subtle">None attached. Manage skills from the session menu.</p>
        ) : (
          <ul className="space-y-1 text-[13px]">
            {session.attachedSkillIds.map((skillId) => (
              <li key={skillId}>
                {detail.availableSkills.find((skill) => skill.id === skillId)?.name ?? skillId}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
