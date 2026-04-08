import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArtificialIntelligence04Icon,
  MoreHorizontalCircle01Icon,
  SidebarRight01Icon,
} from "@hugeicons/core-free-icons"
import { Effect, Stream } from "effect"
import { usePanelRef } from "react-resizable-panels"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type {
  OperatorSessionDetail,
  OperatorSessionEvent,
  OperatorSessionSummary,
  System,
} from "@scout/shared"
import { HubClient } from "@/rpc/client"
import { useOperator } from "@/providers/operator-provider"
import { useTerminalPanel } from "@/providers/terminal-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { OperatorShellVariant } from "./operator-utils"
import {
  SESSION_LIST_REACTIVITY_KEY,
  applyOperatorEvent,
  getApprovalStateMap,
  getEntryIdBySourceEventMap,
  getProjectionContent,
  getProjectionMap,
} from "./operator-utils"
import { ManageSkillsDialog } from "./operator-dialogs"
import { OperatorEventCard, OperatorMarkdown } from "./operator-event-card"
import { OperatorPromptInput } from "./operator-prompt-input"
import { OperatorSessionMeta } from "./operator-session-meta"

export function OperatorSessionPanel({
  sessionId,
  variant,
  fallbackSummary,
  onCreateSession,
  onSelectSession,
}: {
  sessionId: string
  variant: OperatorShellVariant
  fallbackSummary: OperatorSessionSummary | null
  onCreateSession: () => void
  onSelectSession: (sessionId: string) => void
}) {
  const systemsResult = useAtomValue(HubClient.query("systems.list", undefined))
  const systems: ReadonlyArray<System> =
    systemsResult._tag === "Success" ? systemsResult.value : []

  const detailResult = useAtomValue(HubClient.query("operator.sessions.get", { sessionId }))
  const promptMutation = useAtomSet(HubClient.mutation("operator.prompt"), {
    mode: "promise",
  })
  const branchSession = useAtomSet(HubClient.mutation("operator.sessions.branch"), {
    mode: "promise",
  })
  const forkSession = useAtomSet(HubClient.mutation("operator.sessions.fork"), {
    mode: "promise",
  })
  const setSessionSkills = useAtomSet(HubClient.mutation("operator.sessions.setSkills"), {
    mode: "promise",
  })
  const resolveApproval = useAtomSet(HubClient.mutation("operator.approvals.resolve"), {
    mode: "promise",
  })
  const setBypass = useAtomSet(HubClient.mutation("operator.bypass.set"), {
    mode: "promise",
  })
  const setTitle = useAtomSet(HubClient.mutation("operator.sessions.setTitle"), {
    mode: "promise",
  })
  const { openOperatorProjection, updateOperatorProjection } = useTerminalPanel()
  const { optimisticSession, setActiveSessionId, setOptimisticSession } = useOperator()
  const [draft, setDraft] = useState("")
  const fillRef = useRef<((text: string) => void) | null>(null)
  const [isSkillsDialogOpen, setIsSkillsDialogOpen] = useState(false)
  const [draftSkillIds, setDraftSkillIds] = useState<ReadonlyArray<string>>([])
  const [streamingContent, setStreamingContent] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUpdatingSkills, setIsUpdatingSkills] = useState(false)
  const [branchingEntryId, setBranchingEntryId] = useState<string | null>(null)
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null)
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null)
  const [isUpdatingBypass, setIsUpdatingBypass] = useState(false)

  // Collapsible metadata panel
  const metaPanelRef = usePanelRef()

  // Restore collapsed state from localStorage on mount
  useEffect(() => {
    const panel = metaPanelRef.current
    if (!panel || variant !== "page") return
    try {
      const stored = localStorage.getItem("scout:operator:meta-collapsed")
      if (stored === "true" && !panel.isCollapsed()) {
        panel.collapse()
      }
    } catch {
      // ignore
    }
  }, [metaPanelRef, variant])

  // Auto-scroll state
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const detail = useMemo<OperatorSessionDetail | null>(() => {
    if (
      optimisticSession &&
      optimisticSession.session.id === sessionId &&
      detailResult._tag !== "Success"
    ) {
      return optimisticSession
    }
    return detailResult._tag === "Success" ? detailResult.value : null
  }, [detailResult, optimisticSession, sessionId])

  const [liveDetail, setLiveDetail] = useState<OperatorSessionDetail | null>(null)

  useEffect(() => {
    if (!detail) return
    setLiveDetail((current) =>
      current === null || detail.session.lastEventSeq >= current.session.lastEventSeq
        ? detail
        : current,
    )
  }, [detail])

  const streamAtom = useMemo(
    () =>
      HubClient.runtime.pull(
        Stream.unwrap(
          HubClient.use((client) =>
            Effect.succeed(
              client("operator.events.subscribe", {
                sessionId,
                afterSeq: detail?.session.lastEventSeq ?? fallbackSummary?.lastEventSeq ?? 0,
              }) as Stream.Stream<OperatorSessionEvent, unknown>,
            ),
          ),
        ),
        { disableAccumulation: true },
      ),
    [detail?.session.lastEventSeq, fallbackSummary?.lastEventSeq, sessionId],
  )
  const streamResult = useAtomValue(streamAtom)
  const pullNext = useAtomSet(streamAtom)

  useEffect(() => {
    if (streamResult._tag === "Success") {
      const { done, items } = streamResult.value
      if (items.length > 0) {
        // Separate transient streaming events from persistent events
        const persistentItems = items.filter((e) => e.type !== "message.streaming")
        const streamingItems = items.filter((e) => e.type === "message.streaming")

        if (persistentItems.length > 0) {
          setLiveDetail((current) => {
            if (!current) return current
            return persistentItems.reduce(applyOperatorEvent, current)
          })
        }

        // Update streaming content from the latest streaming event
        const lastStreaming = streamingItems.at(-1)
        if (lastStreaming?.message?.content != null) {
          setStreamingContent(lastStreaming.message.content || null)
        }

        // Clear streaming when a final assistant message arrives
        if (
          persistentItems.some(
            (e) => e.type === "message.created" && e.message?.role === "assistant",
          )
        ) {
          setStreamingContent(null)
        }
      }
      if (!done) {
        pullNext(undefined)
      }
    }
  }, [pullNext, streamResult])

  useEffect(() => {
    if (detail && optimisticSession?.session.id === detail.session.id) {
      setOptimisticSession(detail)
    }
  }, [detail, optimisticSession, setOptimisticSession])

  const resolvedDetail = liveDetail ?? detail

  const finishedToolCallIds = useMemo(() => {
    const ids = new Set<string>()
    for (const event of resolvedDetail?.events ?? []) {
      if (event.type === "tool.finished" && event.toolCall?.id) {
        ids.add(event.toolCall.id)
      }
    }
    return ids
  }, [resolvedDetail?.events])

  const visibleEvents = useMemo(
    () =>
      (resolvedDetail?.events ?? []).filter((event) => {
        if (event.type === "approval.resolved") return false
        if (
          event.type === "message.created" &&
          event.message?.role === "assistant" &&
          !event.message.content?.trim()
        )
          return false
        // Hide tool.started when tool.finished exists for the same tool call
        if (
          event.type === "tool.started" &&
          event.toolCall?.id &&
          finishedToolCallIds.has(event.toolCall.id)
        )
          return false
        return true
      }),
    [resolvedDetail?.events, finishedToolCallIds],
  )

  const approvalStateById = useMemo(
    () => getApprovalStateMap(resolvedDetail?.approvals ?? []),
    [resolvedDetail?.approvals],
  )
  const projectionByToolCallId = useMemo(
    () => getProjectionMap(resolvedDetail?.terminalProjections ?? []),
    [resolvedDetail?.terminalProjections],
  )
  const entryIdBySourceEventId = useMemo(
    () => getEntryIdBySourceEventMap(resolvedDetail),
    [resolvedDetail],
  )
  const pendingApprovals = useMemo(
    () => resolvedDetail?.approvals.filter((approval) => approval.status === "pending").length ?? 0,
    [resolvedDetail?.approvals],
  )

  useEffect(() => {
    if (!resolvedDetail) return

    for (const projection of projectionByToolCallId.values()) {
      updateOperatorProjection({
        projectionId: projection.id,
        sessionId,
        toolCallId: projection.toolCallId,
        nodeId: projection.nodeId,
        label: `${resolvedDetail.session.title} • ${projection.nodeId}`,
        content: getProjectionContent(resolvedDetail.events, projection.toolCallId),
      })
    }
  }, [projectionByToolCallId, resolvedDetail, sessionId, updateOperatorProjection])

  // Auto-scroll: scroll to bottom when new events arrive or streaming updates (if user is near bottom)
  useEffect(() => {
    if (isAtBottom && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [visibleEvents.length, streamingContent, isAtBottom])

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const threshold = 80
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < threshold)
  }, [])

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
      setIsAtBottom(true)
    }
  }, [])

  const handlePromptSubmit = async () => {
    const text = draft.trim()
    if (!text) return

    // Detect if this is the first user prompt in the session
    const isFirstPrompt =
      (resolvedDetail?.events.filter((e) => e.message?.role === "user").length ?? 0) === 0

    setIsSubmitting(true)
    try {
      await promptMutation({
        payload: { sessionId, text },
        reactivityKeys: [SESSION_LIST_REACTIVITY_KEY, `operator:session:${sessionId}`],
      })
      setDraft("")

      // Set an immediate fallback title from the first prompt text.
      // The server will asynchronously generate a better LLM title.
      if (isFirstPrompt) {
        const fallbackTitle = text.length > 50 ? `${text.slice(0, 50)}...` : text
        void setTitle({
          payload: { sessionId, title: fallbackTitle },
          reactivityKeys: [SESSION_LIST_REACTIVITY_KEY, `operator:session:${sessionId}`],
        })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResolveApproval = async (
    approvalId: string,
    decision: "approved" | "rejected",
  ) => {
    setResolvingApprovalId(approvalId)
    try {
      await resolveApproval({
        payload: { sessionId, approvalId, decision },
        reactivityKeys: [SESSION_LIST_REACTIVITY_KEY, `operator:session:${sessionId}`],
      })
    } finally {
      setResolvingApprovalId(null)
    }
  }

  const handleBypassUpdate = async (minutes: number | null) => {
    setIsUpdatingBypass(true)
    try {
      await setBypass({
        payload:
          minutes === null
            ? { sessionId, enabled: false }
            : {
                sessionId,
                enabled: true,
                expiresAt: Date.now() + minutes * 60_000,
              },
        reactivityKeys: [SESSION_LIST_REACTIVITY_KEY, `operator:session:${sessionId}`],
      })
    } finally {
      setIsUpdatingBypass(false)
    }
  }

  const handleBranch = async (entryId: string) => {
    setBranchingEntryId(entryId)
    try {
      const next = await branchSession({
        payload: { sessionId, entryId },
        reactivityKeys: [SESSION_LIST_REACTIVITY_KEY, `operator:session:${sessionId}`],
      })
      setOptimisticSession(next)
      setLiveDetail(next)
    } finally {
      setBranchingEntryId(null)
    }
  }

  const handleFork = async (entryId: string) => {
    setForkingEntryId(entryId)
    try {
      const next = await forkSession({
        payload: {
          sessionId,
          entryId,
          title: `${resolvedDetail?.session.title ?? "Operator session"} (fork)`,
        },
        reactivityKeys: [SESSION_LIST_REACTIVITY_KEY],
      })
      setOptimisticSession(next)
      setActiveSessionId(next.session.id)
      setLiveDetail(next)
    } finally {
      setForkingEntryId(null)
    }
  }

  const handleSaveSkills = async () => {
    setIsUpdatingSkills(true)
    try {
      const next = await setSessionSkills({
        payload: { sessionId, skillIds: [...draftSkillIds] },
        reactivityKeys: [SESSION_LIST_REACTIVITY_KEY, `operator:session:${sessionId}`],
      })
      setOptimisticSession(next)
      setLiveDetail(next)
      setIsSkillsDialogOpen(false)
    } finally {
      setIsUpdatingSkills(false)
    }
  }

  if (detailResult._tag === "Initial" && !detail) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading operator session...
      </div>
    )
  }

  if (detailResult._tag === "Failure" && !detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-destructive">Failed to load operator session.</p>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onCreateSession}>
            Start New Session
          </Button>
          {fallbackSummary ? (
            <Button size="sm" variant="outline" onClick={() => onSelectSession(fallbackSummary.id)}>
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  if (!resolvedDetail) {
    return null
  }

  const openSkillsDialog = () => {
    setDraftSkillIds(resolvedDetail.session.attachedSkillIds)
    setIsSkillsDialogOpen(true)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ManageSkillsDialog
        open={isSkillsDialogOpen}
        skills={resolvedDetail.availableSkills}
        selectedSkillIds={draftSkillIds}
        isSaving={isUpdatingSkills}
        onOpenChange={setIsSkillsDialogOpen}
        onToggleSkill={(skillId, checked) =>
          setDraftSkillIds((current) =>
            checked ? [...current, skillId] : current.filter((value) => value !== skillId),
          )
        }
        onSave={handleSaveSkills}
      />
      <SessionHeader
        session={resolvedDetail.session}
        pendingApprovals={pendingApprovals}
        variant={variant}
        isUpdatingBypass={isUpdatingBypass}
        onBypassUpdate={handleBypassUpdate}
        onOpenSkillsDialog={openSkillsDialog}
        onToggleMeta={variant === "page" ? () => {
          const panel = metaPanelRef.current
          if (!panel) return
          if (panel.isCollapsed()) {
            panel.expand()
          } else {
            panel.collapse()
          }
        } : undefined}
      />

      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1"
        id="operator-session"
      >
        <ResizablePanel id="operator-timeline" minSize="300px" defaultSize="70%">
          <div className="flex h-full min-h-0 flex-col">
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="min-h-0 flex-1 overflow-y-auto scrollbar-thin"
            >
              <div className="mx-auto max-w-3xl space-y-3 p-4">
                {visibleEvents.length === 0 ? (
                  <div className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle>Session created</CardTitle>
                        <CardDescription>
                          Send a prompt to get started, or pick a suggestion below.
                        </CardDescription>
                      </CardHeader>
                    </Card>
                    <div className="flex flex-wrap gap-2">
                      {[
                        "Check the health of all nodes",
                        "Are there any active alerts?",
                        "What plugins are available?",
                        "Show me resource usage across nodes",
                      ].map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => fillRef.current?.(suggestion)}
                          className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {visibleEvents.map((event) => (
                      <OperatorEventCard
                        key={event.id}
                        event={event}
                        approvalState={event.approval ? approvalStateById.get(event.approval.id) : undefined}
                        projection={
                          event.toolCall ? projectionByToolCallId.get(event.toolCall.id) : event.projection
                        }
                        branchTargetEntryId={entryIdBySourceEventId.get(event.id)}
                        isBranching={branchingEntryId === entryIdBySourceEventId.get(event.id)}
                        isForking={forkingEntryId === entryIdBySourceEventId.get(event.id)}
                        isResolvingApproval={resolvingApprovalId === event.approval?.id}
                        onBranch={handleBranch}
                        onFork={handleFork}
                        onResolveApproval={handleResolveApproval}
                        onMirrorProjection={(projection) =>
                          openOperatorProjection({
                            projectionId: projection.id,
                            sessionId,
                            toolCallId: projection.toolCallId,
                            nodeId: projection.nodeId,
                            label: `${resolvedDetail.session.title} • ${projection.nodeId}`,
                            content: getProjectionContent(resolvedDetail.events, projection.toolCallId),
                          })
                        }
                      />
                    ))}
                    {streamingContent && (
                      <div className="border-l-2 border-primary/20 py-2 pl-3">
                        <OperatorMarkdown content={streamingContent} isAnimating />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Scroll-to-bottom floating button */}
            {!isAtBottom && visibleEvents.length > 0 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-32 flex justify-center">
                <Button
                  size="icon"
                  variant="outline"
                  className="pointer-events-auto size-8 rounded-full shadow-md"
                  onClick={scrollToBottom}
                >
                  <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
                </Button>
              </div>
            )}

            <OperatorPromptInput
              draft={draft}
              setDraft={setDraft}
              isSubmitting={isSubmitting}
              onSubmit={() => void handlePromptSubmit()}
              bypassMode={resolvedDetail.session.bypassMode}
              nodeCount={resolvedDetail.session.selectedNodeIds.length}
              systems={systems}
              skills={resolvedDetail.availableSkills ?? []}
              models={resolvedDetail.availableModels ?? []}
              selectedNodeIds={resolvedDetail.session.selectedNodeIds}
              modelId={resolvedDetail.session.modelId}
              modelProviderId={resolvedDetail.session.modelProviderId}
              fillRef={fillRef}
            />
          </div>
        </ResizablePanel>

        {variant === "page" ? (
          <>
            <ResizableHandle />
            <ResizablePanel
              id="operator-sidebar"
              panelRef={metaPanelRef}
              minSize="200px"
              defaultSize="30%"
              collapsible
              collapsedSize="0px"
              onResize={() => {
                const panel = metaPanelRef.current
                if (panel) {
                  const collapsed = panel.isCollapsed()
                  try {
                    localStorage.setItem("scout:operator:meta-collapsed", String(collapsed))
                  } catch {
                    // ignore
                  }
                }
              }}
            >
              <ScrollArea className="h-full">
                <div className="space-y-3 p-4">
                  <OperatorSessionMeta detail={resolvedDetail} pendingApprovals={pendingApprovals} />
                </div>
              </ScrollArea>
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
    </div>
  )
}

// ── Compact session header ──────────────────────────────────────────────────

function SessionHeader({
  session,
  pendingApprovals,
  variant,
  isUpdatingBypass,
  onBypassUpdate,
  onOpenSkillsDialog,
  onToggleMeta,
}: {
  session: OperatorSessionSummary
  pendingApprovals: number
  variant: OperatorShellVariant
  isUpdatingBypass: boolean
  onBypassUpdate: (minutes: number | null) => Promise<void>
  onOpenSkillsDialog: () => void
  onToggleMeta?: () => void
}) {
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon icon={ArtificialIntelligence04Icon} size={16} className="shrink-0" />
          <h1 className="truncate font-heading text-base font-semibold">{session.title}</h1>
          {session.status !== "active" ? (
            <Badge variant="outline" className="shrink-0 uppercase">
              {session.status}
            </Badge>
          ) : null}
          {pendingApprovals > 0 ? (
            <Badge variant="outline" className="shrink-0">
              {pendingApprovals} pending
            </Badge>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {onToggleMeta ? (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onToggleMeta}
              className="text-muted-foreground"
            >
              <HugeiconsIcon icon={SidebarRight01Icon} size={16} />
              <span className="sr-only">Toggle metadata panel</span>
            </Button>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="icon-sm" variant="ghost" className="text-muted-foreground" />
              }
            >
              <HugeiconsIcon icon={MoreHorizontalCircle01Icon} size={16} />
              <span className="sr-only">Session actions</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
              <DropdownMenuItem
                disabled={isUpdatingBypass}
                onClick={() => void onBypassUpdate(15)}
              >
                15m bypass
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isUpdatingBypass}
                onClick={() => void onBypassUpdate(60)}
              >
                1h bypass
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isUpdatingBypass || session.bypassMode === "off"}
                onClick={() => void onBypassUpdate(null)}
              >
                Disable bypass
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onOpenSkillsDialog}>
                Manage Skills
              </DropdownMenuItem>
              {variant === "drawer" ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem render={<Link to="/operator" />}>
                    Open Workbench
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
