import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import { Link } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, MoreHorizontalCircle01Icon, SidebarRight01Icon } from "@hugeicons/core-free-icons"
import { Effect, Stream } from "effect"
import { usePanelRef } from "react-resizable-panels"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type {
  OperatorApprovalMode,
  OperatorApprovalRequest,
  OperatorPlanMode,
  OperatorSessionDetail,
  OperatorSessionSummary,
  OperatorTerminalOutput,
  OperatorTimelineItem,
  System,
} from "@scout/shared"
import { HubClient } from "@/rpc/client"
import { useOperator } from "@/providers/operator-provider"
import { useTerminalPanel } from "@/providers/terminal-provider"
import { StatusDot } from "@/components/status-dot"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { OperatorShellVariant } from "./operator-utils"
import { SESSION_LIST_REACTIVITY_KEY, SESSION_STATUS, isOperatorSessionBusy } from "./operator-utils"
import { ManageSkillsDialog } from "./operator-dialogs"
import { OperatorApprovalCard, OperatorTimelineItemCard } from "./operator-timeline-item"
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
  const systems: ReadonlyArray<System> = systemsResult._tag === "Success" ? systemsResult.value : []

  const detailResult = useAtomValue(HubClient.query("operator.sessions.get", { sessionId }))
  const promptMutation = useAtomSet(HubClient.mutation("operator.prompt"), {
    mode: "promise",
  })
  const abortSession = useAtomSet(HubClient.mutation("operator.sessions.abort"), {
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
  const setApprovalMode = useAtomSet(HubClient.mutation("operator.sessions.setApprovalMode"), {
    mode: "promise",
  })
  const setPlanMode = useAtomSet(HubClient.mutation("operator.sessions.setPlanMode"), {
    mode: "promise",
  })
  const setTitle = useAtomSet(HubClient.mutation("operator.sessions.setTitle"), {
    mode: "promise",
  })
  const { openOperatorProjection, updateOperatorProjection } = useTerminalPanel()
  const { optimisticSession, setOptimisticSession } = useOperator()
  const [draft, setDraft] = useState("")
  const fillRef = useRef<((text: string) => void) | null>(null)
  const [isSkillsDialogOpen, setIsSkillsDialogOpen] = useState(false)
  const [draftSkillIds, setDraftSkillIds] = useState<ReadonlyArray<string>>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAborting, setIsAborting] = useState(false)
  const [isUpdatingSkills, setIsUpdatingSkills] = useState(false)
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null)
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null)

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
    if (optimisticSession && optimisticSession.session.id === sessionId && detailResult._tag !== "Success") {
      return optimisticSession
    }
    return detailResult._tag === "Success" ? detailResult.value : null
  }, [detailResult, optimisticSession, sessionId])

  // Latest `operator.sessions.watch` snapshot, patched locally by optimistic mode changes.
  // Until the first snapshot arrives, the query / optimistic detail is shown.
  const [liveDetail, setLiveDetail] = useState<OperatorSessionDetail | null>(null)

  // Bypass `HubClient.query` for the watch stream: AtomRpc's internal pull accumulates every
  // emitted snapshot, while `disableAccumulation` hands over only the snapshots of each pull.
  const watchAtom = useMemo(
    () =>
      HubClient.runtime.pull(
        Stream.unwrap(
          HubClient.use((client) =>
            Effect.succeed(
              client("operator.sessions.watch", { sessionId }) as Stream.Stream<
                OperatorSessionDetail,
                unknown
              >,
            ),
          ),
        ),
        { disableAccumulation: true },
      ),
    [sessionId],
  )
  const watchResult = useAtomValue(watchAtom)
  const pullNext = useAtomSet(watchAtom)

  useEffect(() => {
    if (watchResult._tag !== "Success") return
    const { done, items } = watchResult.value
    const latest = items.at(-1)
    if (latest) {
      setLiveDetail(latest)
    }
    if (!done) {
      pullNext(undefined)
    }
  }, [pullNext, watchResult])

  useEffect(() => {
    if (detail && optimisticSession?.session.id === detail.session.id) {
      setOptimisticSession(detail)
    }
  }, [detail, optimisticSession, setOptimisticSession])

  const resolvedDetail = liveDetail ?? detail
  const timeline = useMemo(() => resolvedDetail?.timeline ?? [], [resolvedDetail?.timeline])
  const sessionTitle = resolvedDetail?.session.title ?? ""

  const approvalById = useMemo(() => {
    const approvals = new Map<string, OperatorApprovalRequest>()
    for (const approval of resolvedDetail?.approvals ?? []) {
      approvals.set(approval.id, approval)
    }
    return approvals
  }, [resolvedDetail?.approvals])

  // Pending approvals whose tool item is not in the timeline still need a decision surface.
  const orphanPendingApprovals = useMemo(() => {
    const referenced = new Set<string>()
    for (const item of timeline) {
      if (item.kind === "tool" && item.approvalId) referenced.add(item.approvalId)
    }
    return (resolvedDetail?.approvals ?? []).filter(
      (approval) => approval.status === "pending" && !referenced.has(approval.id),
    )
  }, [resolvedDetail?.approvals, timeline])

  const pendingApprovals = useMemo(
    () => resolvedDetail?.approvals.filter((approval) => approval.status === "pending").length ?? 0,
    [resolvedDetail?.approvals],
  )

  const firstPendingMutationApprovalId = useMemo(
    () => resolvedDetail?.approvals.find((a) => a.status === "pending" && a.kind === "mutation")?.id ?? null,
    [resolvedDetail?.approvals],
  )

  const mirrorTerminal = useCallback(
    (toolCallId: string, terminal: OperatorTerminalOutput) =>
      openOperatorProjection({
        projectionId: `${sessionId}:${toolCallId}`,
        sessionId,
        toolCallId,
        nodeId: terminal.nodeId,
        label: `${sessionTitle} • ${terminal.nodeId}`,
        base64Chunks: [...terminal.base64Chunks],
      }),
    [openOperatorProjection, sessionId, sessionTitle],
  )

  // Keep already-mirrored terminal tabs in sync; updates for unopened tabs are no-ops.
  useEffect(() => {
    for (const item of timeline) {
      if (item.kind !== "tool" || !item.terminal) continue
      updateOperatorProjection({
        projectionId: `${sessionId}:${item.toolCallId}`,
        sessionId,
        toolCallId: item.toolCallId,
        nodeId: item.terminal.nodeId,
        label: `${sessionTitle} • ${item.terminal.nodeId}`,
        base64Chunks: [...item.terminal.base64Chunks],
      })
    }
  }, [sessionId, sessionTitle, timeline, updateOperatorProjection])

  const lastItem = timeline.at(-1)
  const lastItemSize =
    lastItem?.kind === "assistant"
      ? lastItem.text.length + (lastItem.thinking?.length ?? 0)
      : lastItem?.kind === "tool"
        ? (lastItem.output?.length ?? 0)
        : 0

  // Auto-scroll: follow new timeline items and streaming growth while the user is near the bottom
  useEffect(() => {
    if (isAtBottom && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [timeline.length, lastItemSize, orphanPendingApprovals.length, isAtBottom])

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
    const isFirstPrompt = !timeline.some((item) => item.kind === "user")

    setIsSubmitting(true)
    try {
      await promptMutation({
        payload: { sessionId, text, requestId: crypto.randomUUID() },
        reactivityKeys: [SESSION_LIST_REACTIVITY_KEY, `operator:session:${sessionId}`],
      })
      setDraft("")

      // The hub does not generate titles; name the session after its first prompt.
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

  const handleAbort = useCallback(async () => {
    setIsAborting(true)
    try {
      await abortSession({
        payload: { sessionId },
        reactivityKeys: [SESSION_LIST_REACTIVITY_KEY, `operator:session:${sessionId}`],
      })
    } finally {
      setIsAborting(false)
    }
  }, [abortSession, sessionId])

  const handleResolveApproval = useCallback(
    async (approvalId: string, decision: "approved" | "rejected", answer?: string) => {
      setResolvingApprovalId(approvalId)
      try {
        await resolveApproval({
          payload:
            answer === undefined
              ? { sessionId, approvalId, decision }
              : { sessionId, approvalId, decision, answer },
          reactivityKeys: [SESSION_LIST_REACTIVITY_KEY, `operator:session:${sessionId}`],
        })
      } finally {
        setResolvingApprovalId(null)
      }
    },
    [resolveApproval, sessionId],
  )

  const handleApprovalModeChange = useCallback(
    async (mode: OperatorApprovalMode) => {
      await setApprovalMode({
        payload: { sessionId, approvalMode: mode },
        reactivityKeys: [SESSION_LIST_REACTIVITY_KEY, `operator:session:${sessionId}`],
      })
      setLiveDetail((current) =>
        current ? { ...current, session: { ...current.session, approvalMode: mode } } : current,
      )
    },
    [setApprovalMode, sessionId],
  )

  const handlePlanModeChange = useCallback(
    async (mode: OperatorPlanMode) => {
      await setPlanMode({
        payload: { sessionId, planMode: mode },
        reactivityKeys: [`operator:session:${sessionId}`],
      })
      setLiveDetail((current) =>
        current ? { ...current, session: { ...current.session, planMode: mode } } : current,
      )
    },
    [setPlanMode, sessionId],
  )

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
      onSelectSession(next.session.id)
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
      setLiveDetail((current) => (current ? next : current))
      setIsSkillsDialogOpen(false)
    } finally {
      setIsUpdatingSkills(false)
    }
  }

  // ── Keyboard shortcuts (react-hotkeys-hook) ────────────────────────────────

  useHotkeys(
    "/",
    () => {
      document.querySelector<HTMLElement>(".operator-editor .ProseMirror")?.focus()
    },
    { preventDefault: true },
  )

  useHotkeys(
    "mod+shift+p",
    () => {
      void handlePlanModeChange(resolvedDetail?.session.planMode === "plan_first" ? "off" : "plan_first")
    },
    { preventDefault: true, enableOnFormTags: true, enableOnContentEditable: true },
    [resolvedDetail?.session.planMode, handlePlanModeChange],
  )

  useHotkeys(
    "mod+shift+a",
    () => {
      if (resolvedDetail) void handleApprovalModeChange(nextApprovalMode(resolvedDetail.session.approvalMode))
    },
    { preventDefault: true, enableOnFormTags: true, enableOnContentEditable: true },
    [resolvedDetail, handleApprovalModeChange],
  )

  useHotkeys(
    "mod+.",
    () => {
      if (firstPendingMutationApprovalId)
        void handleResolveApproval(firstPendingMutationApprovalId, "approved")
    },
    {
      preventDefault: true,
      enableOnFormTags: true,
      enableOnContentEditable: true,
      enabled: !!firstPendingMutationApprovalId,
    },
    [firstPendingMutationApprovalId, handleResolveApproval],
  )

  // Command palette custom event listeners
  useEffect(() => {
    const onTogglePlan = () =>
      void handlePlanModeChange(resolvedDetail?.session.planMode === "plan_first" ? "off" : "plan_first")
    const onCycleApproval = () => {
      if (resolvedDetail) void handleApprovalModeChange(nextApprovalMode(resolvedDetail.session.approvalMode))
    }
    const onApprovePending = () => {
      if (firstPendingMutationApprovalId)
        void handleResolveApproval(firstPendingMutationApprovalId, "approved")
    }

    window.addEventListener("scout:operator:toggle-plan-mode", onTogglePlan)
    window.addEventListener("scout:operator:cycle-approval-mode", onCycleApproval)
    window.addEventListener("scout:operator:approve-pending", onApprovePending)
    return () => {
      window.removeEventListener("scout:operator:toggle-plan-mode", onTogglePlan)
      window.removeEventListener("scout:operator:cycle-approval-mode", onCycleApproval)
      window.removeEventListener("scout:operator:approve-pending", onApprovePending)
    }
  }, [
    resolvedDetail,
    firstPendingMutationApprovalId,
    handleApprovalModeChange,
    handlePlanModeChange,
    handleResolveApproval,
  ])

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
        onOpenSkillsDialog={openSkillsDialog}
        onToggleMeta={
          variant === "page"
            ? () => {
                const panel = metaPanelRef.current
                if (!panel) return
                if (panel.isCollapsed()) {
                  panel.expand()
                } else {
                  panel.collapse()
                }
              }
            : undefined
        }
      />

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1" id="operator-session">
        <ResizablePanel id="operator-timeline" minSize="300px" defaultSize="70%">
          <div className="flex h-full min-h-0 flex-col">
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="min-h-0 flex-1 overflow-y-auto scrollbar-thin"
            >
              <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
                {timeline.length === 0 && orphanPendingApprovals.length === 0 ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium">New session</p>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        Ask about your machines, or start from a suggestion. Changes always wait for your
                        approval.
                      </p>
                    </div>
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
                    {timeline.map((item) => (
                      <OperatorTimelineItemCard
                        key={timelineItemKey(item)}
                        item={item}
                        approval={
                          item.kind === "tool" && item.approvalId
                            ? approvalById.get(item.approvalId)
                            : undefined
                        }
                        forkingEntryId={forkingEntryId}
                        resolvingApprovalId={resolvingApprovalId}
                        onFork={handleFork}
                        onResolveApproval={handleResolveApproval}
                        onMirrorTerminal={mirrorTerminal}
                      />
                    ))}
                    {orphanPendingApprovals.map((approval) => (
                      <OperatorApprovalCard
                        key={approval.id}
                        approval={approval}
                        isResolvingApproval={resolvingApprovalId === approval.id}
                        onResolveApproval={handleResolveApproval}
                      />
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* Scroll-to-bottom floating button */}
            {!isAtBottom && timeline.length > 0 && (
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
              isBusy={isOperatorSessionBusy(resolvedDetail.session.status)}
              isAborting={isAborting}
              onAbort={() => void handleAbort()}
              queuedInputs={resolvedDetail.queuedInputs}
              approvalMode={resolvedDetail.session.approvalMode}
              onApprovalModeChange={(mode) => void handleApprovalModeChange(mode)}
              planMode={resolvedDetail.session.planMode}
              onPlanModeChange={(mode) => void handlePlanModeChange(mode)}
              nodeCount={resolvedDetail.session.selectedNodeIds.length}
              systems={systems}
              skills={resolvedDetail.availableSkills}
              models={resolvedDetail.availableModels}
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
                <div className="space-y-6 p-5">
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

const APPROVAL_MODE_CYCLE: ReadonlyArray<OperatorApprovalMode> = [
  "confirm_each_mutation",
  "auto_approve_reads",
  "auto_approve_all",
]

function nextApprovalMode(mode: OperatorApprovalMode): OperatorApprovalMode {
  return APPROVAL_MODE_CYCLE[(APPROVAL_MODE_CYCLE.indexOf(mode) + 1) % APPROVAL_MODE_CYCLE.length]!
}

function timelineItemKey(item: OperatorTimelineItem): string {
  switch (item.kind) {
    case "user":
      return `user:${item.entryId}`
    case "assistant":
      return item.entryId ? `assistant:${item.entryId}` : `assistant:live:${item.createdAt}`
    case "tool":
      return `tool:${item.toolCallId}`
  }
}

// ── Compact session header ──────────────────────────────────────────────────

function SessionHeader({
  session,
  pendingApprovals,
  variant,
  onOpenSkillsDialog,
  onToggleMeta,
}: {
  session: OperatorSessionSummary
  pendingApprovals: number
  variant: OperatorShellVariant
  onOpenSkillsDialog: () => void
  onToggleMeta?: () => void
}) {
  return (
    <div className="border-b border-border px-5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {variant === "page" ? (
            <Link to="/operator" className="shrink-0 text-[13px] text-subtle hover:text-foreground">
              Operator /
            </Link>
          ) : null}
          <h1 className="truncate text-base font-semibold tracking-tight">{session.title}</h1>
          <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
            <StatusDot tone={SESSION_STATUS[session.status].tone} />
            {SESSION_STATUS[session.status].label}
            {pendingApprovals > 1 ? ` · ${pendingApprovals} pending` : ""}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {onToggleMeta ? (
            <Button size="icon-sm" variant="ghost" onClick={onToggleMeta} className="text-muted-foreground">
              <HugeiconsIcon icon={SidebarRight01Icon} size={16} />
              <span className="sr-only">Toggle metadata panel</span>
            </Button>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="icon-sm" variant="ghost" className="text-muted-foreground" />}
            >
              <HugeiconsIcon icon={MoreHorizontalCircle01Icon} size={16} />
              <span className="sr-only">Session actions</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
              <DropdownMenuItem onClick={onOpenSkillsDialog}>Manage Skills</DropdownMenuItem>
              {variant === "drawer" ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem render={<Link to="/operator" />}>Open Workbench</DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
