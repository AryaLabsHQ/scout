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
      className="sd-theme text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
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
    <div className="group space-y-1">
      <div className="flex items-center gap-2 text-xs text-subtle">
        <span>You</span>
        <span>·</span>
        <Timestamp at={item.createdAt} className="text-xs text-subtle" />
        <div className="ml-auto">
          <HoverActions forkEntryId={item.entryId} content={item.text} isForking={isForking} onFork={onFork} />
        </div>
      </div>
      <p className="whitespace-pre-wrap border-l-2 border-border-strong pl-3 text-sm text-foreground">{item.text}</p>
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
    <div className="group space-y-1">
      <div className="flex items-center gap-2 text-xs text-subtle">
        <span>Operator</span>
        {item.streaming ? null : (
          <>
            <span>·</span>
            <Timestamp at={item.createdAt} className="text-xs text-subtle" />
          </>
        )}
        {item.streaming ? null : (
          <div className="ml-auto">
            <HoverActions
              forkEntryId={item.entryId}
              content={hasText ? item.text : undefined}
              isForking={isForking}
              onFork={onFork}
            />
          </div>
        )}
      </div>
      {item.thinking ? (
        <Collapsible>
          <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 text-xs text-subtle hover:text-muted-foreground">
            Thinking
            <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="whitespace-pre-wrap py-1 text-xs text-muted-foreground">{item.thinking}</p>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <div className="min-w-0 text-sm">
        {hasText ? (
          <OperatorMarkdown content={item.text} isAnimating={item.streaming} />
        ) : item.streaming ? (
          <span className="animate-pulse text-subtle">…</span>
        ) : null}
      </div>
      {item.errorMessage ? <p className="text-xs text-err">{item.errorMessage}</p> : null}
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
  const awaitingApproval = approval?.status === "pending"
  const isActive = item.status === "pending" || item.status === "running"
  const isFailed = item.status === "failed"
  const [open, setOpen] = useState(isFailed)
  const formattedArgs = formatToolArgs(item.args)
  const terminal = item.terminal
  const label = toolLabel(item.args)
  const [tone, statusLabel] = awaitingApproval
    ? (["warn", "Awaiting approval"] as const)
    : isFailed
      ? (["err", "Failed"] as const)
      : isActive
        ? (["off", "Running"] as const)
        : approval?.status === "rejected"
          ? (["off", "Rejected"] as const)
          : (["ok", "Completed"] as const)

  return (
    <div className="space-y-2">
      <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-border">
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-raised">
          <span className={cn("inline-block size-2 shrink-0 rounded-full", TONE_BG[tone], isActive && !awaitingApproval && "animate-pulse")} />
          <span className="font-mono">{item.name}</span>
          {label ? <span className="truncate text-muted-foreground">{label}</span> : null}
          {item.nodeIds.length > 0 ? (
            <span className="truncate font-mono text-xs text-subtle">{item.nodeIds.join(", ")}</span>
          ) : null}
          <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-subtle">
            {statusLabel}
            <span>·</span>
            <Timestamp at={item.createdAt} className="text-xs text-subtle" />
            <HugeiconsIcon icon={ArrowDown01Icon} size={14} className={cn("transition-transform", open && "rotate-180")} />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 border-t border-border px-3 py-2">
            {formattedArgs && (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground scrollbar-thin">
                {formattedArgs}
              </pre>
            )}
            {item.output && (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-border pt-2 font-mono text-xs scrollbar-thin">
                {item.output}
              </pre>
            )}
            {terminal && (
              <Button size="sm" variant="outline" onClick={() => onMirrorTerminal(item.toolCallId, terminal)}>
                Mirror in terminal dock
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {approval ? (
        <OperatorApprovalCard
          approval={approval}
          command={toolCommand(item.args)}
          isResolvingApproval={isResolvingApproval}
          onResolveApproval={onResolveApproval}
        />
      ) : null}
    </div>
  )
}

const TONE_BG = { ok: "bg-ok", warn: "bg-warn", err: "bg-err", off: "bg-off" } as const

/** A tool call's own description of what it is doing (`label`), when its arguments carry one. */
function toolLabel(args: unknown): string | null {
  if (typeof args !== "object" || args === null) return null
  const label = (args as Record<string, unknown>)["label"]
  return typeof label === "string" && label.length > 0 ? label : null
}

/** The shell command a tool call runs (`bash_run`), shown verbatim on its approval. */
function toolCommand(args: unknown): string | null {
  if (typeof args !== "object" || args === null) return null
  const command = (args as Record<string, unknown>)["command"]
  return typeof command === "string" && command.length > 0 ? command : null
}

export function OperatorApprovalCard({
  approval,
  command = null,
  isResolvingApproval,
  onResolveApproval,
}: {
  approval: OperatorApprovalRequest
  /** The exact command the approval would run, when the tool call has one. */
  command?: string | null
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

  const nodes = approval.affectedNodeIds.join(", ")

  if (approval.status !== "pending") {
    const verb = approval.status === "approved" ? "Approved" : approval.status === "rejected" ? "Rejected" : "Canceled"
    return (
      <div className="flex flex-wrap items-center gap-2 pl-1 text-xs text-subtle">
        <HugeiconsIcon icon={Shield01Icon} size={13} />
        <span>
          {verb}
          {approval.actor ? ` by ${approval.actor}` : ""}
        </span>
        <span>·</span>
        <Timestamp at={approval.resolvedAt ?? approval.requestedAt} className="text-xs text-subtle" />
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-md border border-warn/30 bg-warn/[0.05] p-4">
      <div className="flex items-center gap-2.5 text-sm font-medium">
        <span className="inline-block size-2 rounded-full bg-warn" />
        Approve a change{nodes ? ` on ${nodes}` : ""}?
        <Timestamp at={approval.requestedAt} className="ml-auto text-xs font-normal text-subtle" />
      </div>
      <p className="text-[13px] text-muted-foreground">
        {approval.reason}. It runs once after approval; a hub restart never runs it again.
      </p>
      {command ? (
        <pre className="overflow-x-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
          $ {command}
        </pre>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={isResolvingApproval}
          onClick={() => void onResolveApproval(approval.id, "approved")}
        >
          {isResolvingApproval ? "Working…" : "Approve and run"}
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
    <div className="space-y-2 rounded-md border border-border-strong p-4">
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
                      isSelected && "border-foreground bg-muted",
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
