import { useCallback, useMemo, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArtificialIntelligence04Icon } from "@hugeicons/core-free-icons"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { OperatorSessionSummary } from "@scout/shared"
import { HubClient } from "@/rpc/client"
import { useOperator } from "@/providers/operator-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatTimeAgo } from "@/lib/format"
import type { OperatorShellVariant } from "./operator-utils"
import { SESSION_LIST_REACTIVITY_KEY } from "./operator-utils"
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
  const persistedSessions = sessionsResult._tag === "Success" ? sessionsResult.value : []

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
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-6 py-5">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <HugeiconsIcon icon={ArtificialIntelligence04Icon} size={20} className="text-green-500" />
              <div>
                <h1 className="font-heading text-base font-semibold">Operator</h1>
                <p className="text-xs text-muted-foreground">
                  {onlineSystemCount} online node{onlineSystemCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <Button onClick={onCreateSession} disabled={isCreating} size="sm">
              {isCreating ? "Creating..." : "New Session"}
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto max-w-3xl space-y-2 p-6">
            {sessions.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-sm text-muted-foreground">
                  No sessions yet. Create one to get started.
                </p>
              </div>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => onSelectSession(session.id)}
                  className="flex w-full items-center justify-between gap-4 border border-border px-4 py-3 text-left transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-medium">{session.title}</p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>
                        {session.selectedNodeIds.length} node{session.selectedNodeIds.length === 1 ? "" : "s"}
                      </span>
                      <span>·</span>
                      <span>{formatTimeAgo(session.updatedAt)}</span>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 text-[10px] uppercase",
                      session.status === "active" && "border-green-500/40 text-green-500",
                      session.status === "waiting_for_user" && "border-yellow-500/40 text-yellow-500",
                    )}
                  >
                    {session.status}
                  </Badge>
                </button>
              ))
            )}
          </div>
        </div>
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
