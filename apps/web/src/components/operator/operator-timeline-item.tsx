import { memo, useState } from "react"
import { Streamdown } from "streamdown"
import { code } from "@streamdown/code"
import { cjk } from "@streamdown/cjk"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  Copy01Icon,
  GitForkIcon,
  HelpCircleIcon,
  Shield01Icon,
  TerminalIcon,
} from "@hugeicons/core-free-icons"
import type {
  OperatorApprovalRequest,
  OperatorTerminalOutput,
  OperatorTimelineItem,
} from "@scout/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { formatTimeAgo } from "@/lib/format"

type UserItem = Extract<OperatorTimelineItem, { kind: "user" }>
type AssistantItem = Extract<OperatorTimelineItem, { kind: "assistant" }>
type ToolItem = Extract<OperatorTimelineItem, { kind: "tool" }>

export type ResolveApproval = (
  approvalId: string,
  decision: "approved" | "rejected",
  answer?: string,
) => Promise<void>

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

export function OperatorTimelineItemCard({
  item,
  approval,
  forkingEntryId,
  resolvingApprovalId,
  onFork,
  onResolveApproval,
  onMirrorTerminal,
}: {
  item: OperatorTimelineItem
  /** The approval referenced by a tool item's `approvalId`. */
  approval?: OperatorApprovalRequest
  forkingEntryId: string | null
  resolvingApprovalId: string | null
  onFork: (entryId: string) => Promise<void>
  onResolveApproval: ResolveApproval
  onMirrorTerminal: (toolCallId: string, terminal: OperatorTerminalOutput) => void
}) {
  switch (item.kind) {
    case "user":
      return <UserMessageCard item={item} isForking={forkingEntryId === item.entryId} onFork={onFork} />
    case "assistant":
      return (
        <AssistantMessageCard
          item={item}
          isForking={item.entryId !== undefined && forkingEntryId === item.entryId}
          onFork={onFork}
        />
      )
    case "tool":
      return (
        <ToolCallCard
          item={item}
          approval={approval}
          isResolvingApproval={approval !== undefined && resolvingApprovalId === approval.id}
          onResolveApproval={onResolveApproval}
          onMirrorTerminal={onMirrorTerminal}
        />
      )
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HoverActions({
  forkEntryId,
  content,
  isForking,
  onFork,
}: {
  forkEntryId?: string
  content?: string
  isForking: boolean
  onFork: (entryId: string) => Promise<void>
}) {
  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      {forkEntryId && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                variant="ghost"
                className="size-6 text-muted-foreground"
                disabled={isForking}
                onClick={() => void onFork(forkEntryId)}
              />
            }
          >
            <HugeiconsIcon icon={GitForkIcon} size={12} />
          </TooltipTrigger>
          <TooltipContent>Fork session</TooltipContent>
        </Tooltip>
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
  item,
  isForking,
  onFork,
}: {
  item: UserItem
  isForking: boolean
  onFork: (entryId: string) => Promise<void>
}) {
  return (
    <div className="group ml-auto max-w-[80%] space-y-1 rounded-lg bg-secondary px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="whitespace-pre-wrap text-xs text-foreground">{item.text}</p>
        <Timestamp at={item.createdAt} />
      </div>
      <div className="flex justify-end">
        <HoverActions
          forkEntryId={item.entryId}
          content={item.text}
          isForking={isForking}
          onFork={onFork}
        />
      </div>
    </div>
  )
}

function AssistantMessageCard({
  item,
  isForking,
  onFork,
}: {
  item: AssistantItem
  isForking: boolean
  onFork: (entryId: string) => Promise<void>
}) {
  const hasText = item.text.trim().length > 0
  if (!hasText && !item.streaming && !item.thinking && !item.errorMessage) {
    return null
  }

  return (
    <div className="group space-y-1 border-l-2 border-primary/20 py-2 pl-3">
      {item.thinking ? (
        <Collapsible>
          <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
            Thinking
            <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="whitespace-pre-wrap py-1 text-[11px] text-muted-foreground">{item.thinking}</p>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {hasText ? (
            <OperatorMarkdown content={item.text} isAnimating={item.streaming} />
          ) : item.streaming ? (
            <span className="animate-pulse text-xs text-muted-foreground">...</span>
          ) : null}
        </div>
        {item.streaming ? null : <Timestamp at={item.createdAt} />}
      </div>
      {item.errorMessage ? (
        <p className="text-[11px] text-destructive">{item.errorMessage}</p>
      ) : null}
      {item.streaming ? null : (
        <div className="flex justify-end">
          <HoverActions
            forkEntryId={item.entryId}
            content={hasText ? item.text : undefined}
            isForking={isForking}
            onFork={onFork}
          />
        </div>
      )}
    </div>
  )
}

function formatToolArgs(args: unknown): string | null {
  if (args === undefined || args === null) return null
  if (typeof args === "object" && Object.keys(args).length === 0) return null
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

function ToolCallCard({
  item,
  approval,
  isResolvingApproval,
  onResolveApproval,
  onMirrorTerminal,
}: {
  item: ToolItem
  approval?: OperatorApprovalRequest
  isResolvingApproval: boolean
  onResolveApproval: ResolveApproval
  onMirrorTerminal: (toolCallId: string, terminal: OperatorTerminalOutput) => void
}) {
  const isActive = item.status === "pending" || item.status === "running"
  const isFailed = item.status === "failed"
  const [open, setOpen] = useState(isActive || isFailed)
  const formattedArgs = formatToolArgs(item.args)
  const terminal = item.terminal

  const statusColor = isActive
    ? "text-muted-foreground"
    : isFailed
      ? "text-red-500"
      : "text-green-500"

  return (
    <div className="space-y-1">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/40">
          <HugeiconsIcon icon={TerminalIcon} size={14} className="shrink-0 text-muted-foreground" />
          <Badge variant="outline">{item.name}</Badge>
          <Badge
            variant="outline"
            className={cn("uppercase", statusColor, isActive && "animate-pulse")}
          >
            {item.status}
          </Badge>
          <Timestamp at={item.createdAt} />
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
            {item.nodeIds.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {item.nodeIds.map((nodeId) => (
                  <Badge key={nodeId} variant="outline">
                    {nodeId}
                  </Badge>
                ))}
              </div>
            )}
            {formattedArgs && (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap bg-muted/40 p-2 text-[11px] text-muted-foreground scrollbar-thin">
                {formattedArgs}
              </pre>
            )}
            {item.output && (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap bg-muted/40 p-2 text-[11px] scrollbar-thin">
                {item.output}
              </pre>
            )}
            {terminal && (
              <Button size="sm" variant="outline" onClick={() => onMirrorTerminal(item.toolCallId, terminal)}>
                Mirror in Dock
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {approval ? (
        <OperatorApprovalCard
          approval={approval}
          isResolvingApproval={isResolvingApproval}
          onResolveApproval={onResolveApproval}
        />
      ) : null}
    </div>
  )
}

export function OperatorApprovalCard({
  approval,
  isResolvingApproval,
  onResolveApproval,
}: {
  approval: OperatorApprovalRequest
  isResolvingApproval: boolean
  onResolveApproval: ResolveApproval
}) {
  if (approval.kind === "clarification") {
    return (
      <ClarificationCard
        approval={approval}
        isResolvingApproval={isResolvingApproval}
        onResolveApproval={onResolveApproval}
      />
    )
  }

  const borderColor =
    approval.status === "pending"
      ? "border-yellow-500"
      : approval.status === "approved"
        ? "border-green-500"
        : "border-red-500"

  return (
    <div className={cn("ml-3 space-y-2 border-l-2 py-2 pl-3", borderColor)}>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <HugeiconsIcon icon={Shield01Icon} size={14} className="text-muted-foreground" />
        <Badge variant="outline" className="uppercase">
          {approval.status === "pending" ? approval.kind : approval.status}
        </Badge>
        <span className="text-muted-foreground">{approval.reason}</span>
        {approval.actor ? <span className="text-muted-foreground">by {approval.actor}</span> : null}
        <Timestamp at={approval.resolvedAt ?? approval.requestedAt} className="ml-auto" />
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
      {approval.status === "pending" && (
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

function ClarificationCard({
  approval,
  isResolvingApproval,
  onResolveApproval,
}: {
  approval: OperatorApprovalRequest
  isResolvingApproval: boolean
  onResolveApproval: ResolveApproval
}) {
  const question = approval.question
  const [selectedLabels, setSelectedLabels] = useState<ReadonlyArray<string>>([])
  const [freeText, setFreeText] = useState("")

  const answer = [selectedLabels.join(", "), freeText.trim()].filter(Boolean).join("\n")

  const toggleOption = (label: string) => {
    setSelectedLabels((current) => {
      if (current.includes(label)) return current.filter((value) => value !== label)
      return question?.multiple ? [...current, label] : [label]
    })
  }

  return (
    <div className="ml-3 space-y-2 border-l-2 border-blue-500 py-2 pl-3">
      <div className="flex items-center gap-2 text-[11px]">
        <HugeiconsIcon icon={HelpCircleIcon} size={14} className="text-muted-foreground" />
        <Badge variant="outline">{question?.header ?? "question"}</Badge>
        {approval.status !== "pending" ? (
          <Badge variant="outline" className="uppercase">
            {approval.status}
          </Badge>
        ) : null}
        {approval.actor ? <span className="text-muted-foreground">by {approval.actor}</span> : null}
        <Timestamp at={approval.resolvedAt ?? approval.requestedAt} className="ml-auto" />
      </div>
      <p className="whitespace-pre-wrap text-xs font-medium">{question?.question ?? approval.reason}</p>
      {approval.status === "pending" ? (
        <div className="space-y-2">
          {question && question.options.length > 0 ? (
            <div className="flex flex-col gap-1">
              {question.options.map((option) => {
                const isSelected = selectedLabels.includes(option.label)
                return (
                  <button
                    key={option.label}
                    type="button"
                    disabled={isResolvingApproval}
                    aria-pressed={isSelected}
                    onClick={() => toggleOption(option.label)}
                    className={cn(
                      "flex flex-col gap-0.5 border border-border px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/40",
                      isSelected && "border-primary bg-accent",
                    )}
                  >
                    <span className="font-medium">{option.label}</span>
                    {option.description ? (
                      <span className="text-[10px] text-muted-foreground">{option.description}</span>
                    ) : null}
                  </button>
                )
              })}
              {question.multiple ? (
                <span className="text-[10px] text-muted-foreground">Select one or more</span>
              ) : null}
            </div>
          ) : null}
          <Textarea
            value={freeText}
            disabled={isResolvingApproval}
            placeholder={question && question.options.length > 0 ? "Or type your own answer..." : "Type your answer..."}
            onChange={(event) => setFreeText(event.target.value)}
            className="min-h-12"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={isResolvingApproval || answer.length === 0}
              onClick={() => void onResolveApproval(approval.id, "approved", answer)}
            >
              {isResolvingApproval ? "Working..." : "Answer"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isResolvingApproval}
              onClick={() => void onResolveApproval(approval.id, "rejected")}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : approval.answer ? (
        <p className="whitespace-pre-wrap text-xs text-muted-foreground">{approval.answer}</p>
      ) : null}
    </div>
  )
}
