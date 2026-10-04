import { useCallback, useMemo, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import { MoreHorizontalIcon } from "@hugeicons/core-free-icons"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { OperatorSessionSummary } from "@scout/shared"
import { HubClient } from "@/rpc/client"
import { useOperator } from "@/providers/operator-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EmptyRow, Page, PageHeader, Section } from "@/components/section"
import { TimeAgo } from "@/components/time-ago"
import { StatusDot } from "@/components/status-dot"
import { useConfirm } from "@/providers/confirm-provider"
import { useHydrated } from "@/hooks/use-hydrated"
import { cn } from "@/lib/utils"
import type { OperatorShellVariant } from "./operator-utils"
import { SESSION_LIST_REACTIVITY_KEY, SESSION_STATUS } from "./operator-utils"
import { OperatorSessionPanel } from "./operator-session-panel"

export function OperatorShell({
  variant,
  className,
  initialSessionId,
}: {
  variant: OperatorShellVariant
  className?: string
  initialSessionId?: string
}) {
  const navigate = useNavigate()
  const sessionsResult = useAtomValue(
    HubClient.query("operator.sessions.list", undefined),
  )
  const systemsResult = useAtomValue(HubClient.query("systems.list", undefined))
  const createSession = useAtomSet(HubClient.mutation("operator.sessions.create"), {
    mode: "promise",
  })
  const {
    activeSessionId: drawerSessionId,
    optimisticSession,
    openDrawer,
    setActiveSessionId,
    setOptimisticSession,
  } = useOperator()
  const [isCreating, setIsCreating] = useState(false)

  // For page variant, the route param is the source of truth.
  // For drawer variant, the provider state is the source of truth.
  const resolvedSessionId = variant === "page" ? (initialSessionId ?? null) : drawerSessionId

  const systems = systemsResult._tag === "Success" ? systemsResult.value : []
  const onlineSystems = systems.filter((system) => system.status === "online")
  // The session list is not seeded by the SSR loader; render it only after hydration.
  const hydrated = useHydrated()
  const persistedSessions = useMemo(
    () => (hydrated && sessionsResult._tag === "Success" ? sessionsResult.value : []),
    [hydrated, sessionsResult],
  )

  const sessions = useMemo(() => {
    if (!optimisticSession) return persistedSessions
    const alreadyPresent = persistedSessions.some(
      (session) => session.id === optimisticSession.session.id,
    )
    return alreadyPresent ? persistedSessions : [optimisticSession.session, ...persistedSessions]
  }, [optimisticSession, persistedSessions])

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      if (variant === "page") {
        void navigate({ to: "/operator/$sessionId", params: { sessionId } })
      } else {
        setActiveSessionId(sessionId)
      }
    },
    [variant, navigate, setActiveSessionId],
  )

  const handleCreateSession = useCallback(async () => {
    setIsCreating(true)
    try {
      const next = await createSession({
        payload: {},
        reactivityKeys: [SESSION_LIST_REACTIVITY_KEY],
      })

      setOptimisticSession(next)

      if (variant === "page") {
        void navigate({ to: "/operator/$sessionId", params: { sessionId: next.session.id } })
      } else {
        setActiveSessionId(next.session.id)
        openDrawer({ sessionId: next.session.id })
      }
    } finally {
      setIsCreating(false)
    }
  }, [createSession, navigate, openDrawer, setActiveSessionId, setOptimisticSession, variant])

  return (
    <div
      className={cn(
        "h-full min-h-0 overflow-hidden bg-background",
        className,
      )}
    >
      <OperatorSessionSurface
        variant={variant}
        activeSessionId={resolvedSessionId}
        sessions={sessions}
        onlineSystemCount={onlineSystems.length}
        isCreating={isCreating}
        onCreateSession={() => void handleCreateSession()}
        onSelectSession={handleSelectSession}
      />
    </div>
  )
}

function OperatorSessionSurface({
  variant,
  activeSessionId,
  sessions,
  onlineSystemCount,
  isCreating,
  onCreateSession,
  onSelectSession,
}: {
  variant: OperatorShellVariant
  activeSessionId: string | null
  sessions: ReadonlyArray<OperatorSessionSummary>
  onlineSystemCount: number
  isCreating: boolean
  onCreateSession: () => void
  onSelectSession: (sessionId: string) => void
}) {
  if (!activeSessionId) {
    return (
      <div className="h-full overflow-y-auto scrollbar-thin">
        <Page className={variant === "drawer" ? "px-5 pt-6" : undefined}>
          <PageHeader
            title="Operator"
            meta={
              <span>
                An agent that inspects your machines and asks before it changes anything · {onlineSystemCount} online
                machine{onlineSystemCount === 1 ? "" : "s"}
              </span>
            }
            actions={
              <Button onClick={onCreateSession} disabled={isCreating} size="sm">
                {isCreating ? "Creating…" : "New session"}
              </Button>
            }
          />
          <Section className="mt-6">
            {sessions.length === 0 ? (
              <EmptyRow>No sessions yet. Start one to ask about a machine.</EmptyRow>
            ) : (
              <table className="w-full table-fixed text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-raised text-xs text-subtle">
                    <th className="px-4 py-2 font-normal">Session</th>
                    <th className="w-40 px-4 py-2 font-normal max-sm:hidden">Machines</th>
                    <th className="w-52 px-4 py-2 font-normal">Status</th>
                    <th className="w-28 px-4 py-2 text-right font-normal">Updated</th>
                    <th className="w-12 px-2 py-2" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <SessionRow key={session.id} session={session} onSelect={() => onSelectSession(session.id)} />
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </Page>
      </div>
    )
  }

  return (
    <OperatorSessionPanel
      key={activeSessionId}
      sessionId={activeSessionId}
      variant={variant}
      fallbackSummary={sessions.find((session) => session.id === activeSessionId) ?? null}
      onCreateSession={onCreateSession}
      onSelectSession={onSelectSession}
    />
  )
}

function SessionRow({ session, onSelect }: { session: OperatorSessionSummary; onSelect: () => void }) {
  const confirm = useConfirm()
  const { activeSessionId, setActiveSessionId } = useOperator()
  const archive = useAtomSet(HubClient.mutation("operator.sessions.archive"), { mode: "promise" })
  const remove = useAtomSet(HubClient.mutation("operator.sessions.delete"), { mode: "promise" })
  const rename = useAtomSet(HubClient.mutation("operator.sessions.setTitle"), { mode: "promise" })
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(session.title)
  const status = SESSION_STATUS[session.status]

  const finishRename = async () => {
    setRenaming(false)
    const next = title.trim()
    if (next.length === 0 || next === session.title) return
    await rename({ payload: { sessionId: session.id, title: next }, reactivityKeys: [SESSION_LIST_REACTIVITY_KEY] })
  }

  const onArchive = async () => {
    const confirmed = await confirm({
      title: `Archive “${session.title}”?`,
      description: "The session leaves the list. Its transcript is kept.",
      confirmLabel: "Archive",
    })
    if (!confirmed) return
    if (activeSessionId === session.id) setActiveSessionId(null)
    await archive({ payload: { sessionId: session.id }, reactivityKeys: [SESSION_LIST_REACTIVITY_KEY] })
  }

  const onDelete = async () => {
    const confirmed = await confirm({
      title: `Delete “${session.title}”?`,
      description: "The session and its whole history are deleted. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!confirmed) return
    if (activeSessionId === session.id) setActiveSessionId(null)
    await remove({ payload: { sessionId: session.id }, reactivityKeys: [SESSION_LIST_REACTIVITY_KEY] })
  }

  return (
    <tr className="cursor-pointer border-t border-border first:border-t-0 hover:bg-raised" onClick={renaming ? undefined : onSelect}>
      <td className="truncate px-4 py-2.5">
        {renaming ? (
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={() => void finishRename()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void finishRename()
              if (event.key === "Escape") {
                setTitle(session.title)
                setRenaming(false)
              }
            }}
            className="w-full rounded border border-border-strong bg-background px-2 py-1 text-[13px] outline-none"
          />
        ) : (
          session.title
        )}
      </td>
      <td className="truncate px-4 py-2.5 font-mono text-muted-foreground max-sm:hidden">
        {session.selectedNodeIds.join(", ") || "—"}
      </td>
      <td className="px-4 py-2.5">
        <span className="flex items-center gap-2 text-muted-foreground">
          <StatusDot tone={status.tone} />
          {status.label}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right text-subtle"><TimeAgo at={session.updatedAt} /></td>
      <td className="px-2 py-1 text-right" onClick={(event) => event.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="inline-grid size-7 place-items-center rounded-md text-subtle hover:bg-muted hover:text-foreground"
                aria-label={`Actions for ${session.title}`}
              />
            }
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => setRenaming(true)}>Rename</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void onArchive()}>Archive…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void onDelete()}>
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  )
}
