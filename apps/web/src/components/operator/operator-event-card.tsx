import { memo, useState } from "react"
import { Streamdown } from "streamdown"
import { code } from "@streamdown/code"
import { cjk } from "@streamdown/cjk"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  Copy01Icon,
  Edit02Icon,
  GitBranchIcon,
  GitForkIcon,
  Shield01Icon,
  TerminalIcon,
} from "@hugeicons/core-free-icons"
import type {
  OperatorApprovalRequest,
  OperatorSessionEvent,
  OperatorTerminalProjection,
} from "@scout/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { formatTimeAgo } from "@/lib/format"

function Timestamp({ at, className }: { at: number; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={cn("shrink-0 cursor-default text-[11px] text-muted-foreground", className)} />
        }
      >
        {formatTimeAgo(at)}
      </TooltipTrigger>
      <TooltipContent>{new Date(at).toLocaleString()}</TooltipContent>
    </Tooltip>
  )
}
import { formatDuration } from "./operator-utils"

const streamdownPlugins = { code, cjk }

const OperatorMarkdown = memo(
  ({ content, isAnimating = false }: { content: string; isAnimating?: boolean }) => (
    <Streamdown
      className="sd-theme text-xs leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      plugins={streamdownPlugins}
      controls={false}
      isAnimating={isAnimating}
    >
      {content}
    </Streamdown>
  ),
  (prev, next) => prev.content === next.content && prev.isAnimating === next.isAnimating,
)
OperatorMarkdown.displayName = "OperatorMarkdown"
export { OperatorMarkdown }

export function OperatorEventCard({
  event,
  approvalState,
  projection,
  branchTargetEntryId,
  isBranching,
  isForking,
  isResolvingApproval,
  onBranch,
  onFork,
  onResolveApproval,
  onMirrorProjection,
}: {
  event: OperatorSessionEvent
  approvalState?: OperatorApprovalRequest
  projection?: OperatorTerminalProjection
  branchTargetEntryId?: string
  isBranching: boolean
  isForking: boolean
  isResolvingApproval: boolean
  onBranch: (entryId: string) => Promise<void>
  onFork: (entryId: string) => Promise<void>
  onResolveApproval: (approvalId: string, decision: "approved" | "rejected") => Promise<void>
  onMirrorProjection: (projection: OperatorTerminalProjection) => void
}) {
  const effectiveApproval = approvalState ?? event.approval

  // User message
  if (event.message?.role === "user") {
    return (
      <UserMessageCard
        event={event}
        branchTargetEntryId={branchTargetEntryId}
        isBranching={isBranching}
        isForking={isForking}
        onBranch={onBranch}
        onFork={onFork}
      />
    )
  }

  // Assistant message with non-empty content
  if (event.message?.role === "assistant" && event.message.content?.trim()) {
    return (
      <AssistantMessageCard
        event={event}
        branchTargetEntryId={branchTargetEntryId}
        isBranching={isBranching}
        isForking={isForking}
        onBranch={onBranch}
        onFork={onFork}
      />
    )
  }

  // Tool call
  if (event.toolCall) {
    return (
      <ToolCallCard
        event={event}
        projection={projection}
        onMirrorProjection={onMirrorProjection}
      />
    )
  }

  // Approval requested
  if (event.type === "approval.requested" && effectiveApproval) {
    return (
      <ApprovalCard
        event={event}
        approval={effectiveApproval}
        isResolvingApproval={isResolvingApproval}
        onResolveApproval={onResolveApproval}
      />
    )
  }

  // System events: skills.updated, session.completed
  if (
    event.type === "skills.updated" ||
    event.type === "session.completed"
  ) {
    return <SystemEventCard event={event} />
  }

  // Plan events
  if (event.plan) {
    return <PlanCard event={event} />
  }

  // Standalone projection events (not attached to a tool call)
  if (event.projection) {
    return (
      <div className="flex flex-wrap items-center gap-2 py-2 text-[11px] text-muted-foreground">
        <Badge variant="outline">terminal</Badge>
        <span>{event.projection.nodeId}</span>
        <Button size="sm" variant="outline" onClick={() => onMirrorProjection(event.projection!)}>
          Mirror in Dock
        </Button>
      </div>
    )
  }

  return null
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HoverActions({
  branchTargetEntryId,
  content,
  isBranching,
  isForking,
  onBranch,
  onFork,
}: {
  branchTargetEntryId?: string
  content?: string
  isBranching: boolean
  isForking: boolean
  onBranch: (entryId: string) => Promise<void>
  onFork: (entryId: string) => Promise<void>
}) {
  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      {branchTargetEntryId && (
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground"
                  disabled={isBranching}
                  onClick={() => void onBranch(branchTargetEntryId)}
                />
              }
            >
              <HugeiconsIcon icon={GitBranchIcon} size={12} />
            </TooltipTrigger>
            <TooltipContent>Branch here</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground"
                  disabled={isForking}
                  onClick={() => void onFork(branchTargetEntryId)}
                />
              }
            >
              <HugeiconsIcon icon={GitForkIcon} size={12} />
            </TooltipTrigger>
            <TooltipContent>Fork session</TooltipContent>
          </Tooltip>
        </>
      )}
      {content && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                variant="ghost"
                className="size-6 text-muted-foreground"
                onClick={() => void navigator.clipboard.writeText(content)}
              />
            }
          >
            <HugeiconsIcon icon={Copy01Icon} size={12} />
          </TooltipTrigger>
          <TooltipContent>Copy</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

function UserMessageCard({
  event,
  branchTargetEntryId,
  isBranching,
  isForking,
  onBranch,
  onFork,
}: {
  event: OperatorSessionEvent
  branchTargetEntryId?: string
  isBranching: boolean
  isForking: boolean
  onBranch: (entryId: string) => Promise<void>
  onFork: (entryId: string) => Promise<void>
}) {
  return (
    <div className="group ml-auto max-w-[80%] space-y-1 rounded-lg bg-secondary px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="whitespace-pre-wrap text-xs text-foreground">{event.message?.content}</p>
        <Timestamp at={event.at} />
      </div>
      <div className="flex justify-end">
        <HoverActions
          branchTargetEntryId={branchTargetEntryId}
          content={event.message?.content}
          isBranching={isBranching}
          isForking={isForking}
          onBranch={onBranch}
          onFork={onFork}
        />
      </div>
    </div>
  )
}

function AssistantMessageCard({
  event,
  branchTargetEntryId,
  isBranching,
  isForking,
  onBranch,
  onFork,
}: {
  event: OperatorSessionEvent
  branchTargetEntryId?: string
  isBranching: boolean
  isForking: boolean
  onBranch: (entryId: string) => Promise<void>
  onFork: (entryId: string) => Promise<void>
}) {
  return (
    <div className="group space-y-1 border-l-2 border-primary/20 py-2 pl-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <OperatorMarkdown content={event.message?.content ?? ""} />
        </div>
        <Timestamp at={event.at} />
      </div>
      <div className="flex justify-end">
        <HoverActions
          branchTargetEntryId={branchTargetEntryId}
          content={event.message?.content}
          isBranching={isBranching}
          isForking={isForking}
          onBranch={onBranch}
          onFork={onFork}
        />
      </div>
    </div>
  )
}

function ToolCallCard({
  event,
  projection,
  onMirrorProjection,
}: {
  event: OperatorSessionEvent
  projection?: OperatorTerminalProjection
  onMirrorProjection: (projection: OperatorTerminalProjection) => void
}) {
  const toolCall = event.toolCall!
  const isRunning = toolCall.status === "running"
  const isFailed = toolCall.status === "failed"
  const defaultOpen = isRunning || isFailed

  const [open, setOpen] = useState(defaultOpen)

  const statusColor = isRunning
    ? "text-muted-foreground"
    : isFailed
      ? "text-red-500"
      : "text-green-500"

  return (
    <Collapsible defaultOpen={defaultOpen} open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/40">
        <HugeiconsIcon icon={TerminalIcon} size={14} className="shrink-0 text-muted-foreground" />
        <Badge variant="outline">{toolCall.name}</Badge>
        <Badge
          variant="outline"
          className={cn("uppercase", statusColor, isRunning && "animate-pulse")}
        >
          {toolCall.status}
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          {formatDuration(toolCall.startedAt, toolCall.finishedAt)}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={14}
          className={cn(
            "ml-auto shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 px-3 pb-2 pt-1">
          {toolCall.nodeIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {toolCall.nodeIds.map((nodeId) => (
                <Badge key={nodeId} variant="outline">
                  {nodeId}
                </Badge>
              ))}
            </div>
          )}
          {toolCall.summary && (
            <div className="text-[11px] text-muted-foreground">
              <OperatorMarkdown content={toolCall.summary} />
            </div>
          )}
          {projection && (
            <Button size="sm" variant="outline" onClick={() => onMirrorProjection(projection)}>
              Mirror in Dock
            </Button>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ApprovalCard({
  event,
  approval,
  isResolvingApproval,
  onResolveApproval,
}: {
  event: OperatorSessionEvent
  approval: OperatorApprovalRequest
  isResolvingApproval: boolean
  onResolveApproval: (approvalId: string, decision: "approved" | "rejected") => Promise<void>
}) {
  // Clarification cards get a distinct presentation
  if (approval.kind === "clarification") {
    return (
      <div className="space-y-2 border-l-2 border-blue-500 py-2 pl-3">
        <div className="flex items-center gap-2 text-[11px]">
          <Badge variant="outline">question</Badge>
          <Timestamp at={event.at} className="ml-auto" />
        </div>
        <p className="text-xs font-medium">{approval.reason}</p>
        {approval.status === "pending" && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={isResolvingApproval}
              onClick={() => void onResolveApproval(approval.id, "approved")}
            >
              {isResolvingApproval ? "Working..." : "Continue"}
            </Button>
            <span className="self-center text-[10px] text-muted-foreground">
              or answer in the prompt below
            </span>
          </div>
        )}
      </div>
    )
  }

  const borderColor =
    approval.status === "pending"
      ? "border-yellow-500"
      : approval.status === "approved"
        ? "border-green-500"
        : "border-red-500"

  return (
    <div className={cn("space-y-2 border-l-2 py-2 pl-3", borderColor)}>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <HugeiconsIcon icon={Shield01Icon} size={14} className="text-muted-foreground" />
        <Badge variant="outline" className="uppercase">
          {approval.kind}
        </Badge>
        <span className="text-muted-foreground">{approval.reason}</span>
        <Timestamp at={event.at} className="ml-auto" />
      </div>
      {approval.affectedNodeIds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {approval.affectedNodeIds.map((nodeId) => (
            <Badge key={nodeId} variant="outline">
              {nodeId}
            </Badge>
          ))}
        </div>
      )}
      {event.type === "approval.requested" && approval.status === "pending" && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={isResolvingApproval}
            onClick={() => void onResolveApproval(approval.id, "approved")}
          >
            {isResolvingApproval ? "Working..." : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isResolvingApproval}
            onClick={() => void onResolveApproval(approval.id, "rejected")}
          >
            Reject
          </Button>
        </div>
      )}
    </div>
  )
}

function SystemEventCard({ event }: { event: OperatorSessionEvent }) {
  let description: string

  switch (event.type) {
    case "skills.updated":
      description = `Skills updated (${event.skillIds?.length ?? 0} attached)`
      break
    case "session.completed":
      description = `Session ${event.status ?? "completed"}`
      break
    default:
      description = event.type
  }

  return (
    <div className="mx-auto py-2 text-center text-[11px] text-muted-foreground">
      {description}
    </div>
  )
}

function PlanCard({ event }: { event: OperatorSessionEvent }) {
  const plan = event.plan!
  return (
    <div className="space-y-2 border border-border/80 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={Edit02Icon} size={14} className="text-muted-foreground" />
          <p className="text-xs font-medium">{plan.summary}</p>
        </div>
        <Timestamp at={event.at} />
      </div>
      <div className="space-y-1">
        {plan.steps.map((step) => (
          <div
            key={step.id}
            className="flex items-center justify-between gap-3 border-l border-border pl-3 text-[11px]"
          >
            <span>{step.label}</span>
            <Badge variant="outline" className="uppercase">
              {step.status}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  )
}
