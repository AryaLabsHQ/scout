import { useEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArtificialIntelligence04Icon,
  TerminalIcon,
  Cancel01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Add01Icon,
  Edit02Icon,
} from "@hugeicons/core-free-icons"
import { useTerminalPanel, type TerminalTab as TerminalTabType } from "@/providers/terminal-provider"
import { useAtomValue } from "@effect/atom-react"
import { HubClient } from "@/rpc/client"
import { TerminalView } from "./terminal-view"
import { OperatorProjectionView } from "./operator-projection-view"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

function TerminalTab({
  tab,
  isActive,
  renameSignal,
  onSelect,
  onClose,
  onRename,
  onCloseOthers,
  onRequestRename,
}: {
  tab: TerminalTabType
  isActive: boolean
  renameSignal: number
  onSelect: () => void
  onClose: () => void
  onRename: (label: string) => void
  onCloseOthers: () => void
  onRequestRename: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(tab.label)
  const inputRef = useRef<HTMLInputElement>(null)
  const canRename = tab.kind === "interactive"

  const startEdit = () => {
    if (!canRename) return
    setDraft(tab.label)
    setEditing(true)
  }

  useEffect(() => {
    if (renameSignal > 0) startEdit()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameSignal])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      if (detail === tab.id) startEdit()
    }
    window.addEventListener("scout:rename-active-tab", handler)
    return () => window.removeEventListener("scout:rename-active-tab", handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  useEffect(() => {
    if (editing) {
      const raf = requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
      return () => cancelAnimationFrame(raf)
    }
  }, [editing])

  const commit = () => {
    onRename(draft)
    setEditing(false)
  }

  const cancel = () => {
    setDraft(tab.label)
    setEditing(false)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            onClick={() => {
              if (!editing) onSelect()
            }}
            onDoubleClick={(event) => {
              event.stopPropagation()
              startEdit()
            }}
            className={cn(
              "flex h-9 items-center gap-1.5 border-r border-border px-3 text-[11px] whitespace-nowrap transition-colors",
              isActive
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
            )}
          />
        }
      >
        {tab.kind === "operator_projection" ? (
          <HugeiconsIcon icon={ArtificialIntelligence04Icon} size={11} />
        ) : null}
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === "Enter") commit()
              else if (event.key === "Escape") cancel()
            }}
            onBlur={commit}
            className="max-w-[160px] min-w-[40px] border-b border-primary/60 bg-transparent text-[11px] outline-none"
            style={{ width: `${Math.max(draft.length, 4)}ch` }}
          />
        ) : (
          <span className="max-w-[160px] truncate">{tab.label}</span>
        )}
        {tab.kind === "operator_projection" ? (
          <span className="text-[10px] uppercase text-muted-foreground/70">RO</span>
        ) : null}
        <span
          role="button"
          tabIndex={0}
          className="ml-0.5 rounded hover:text-red-400 focus:outline-none"
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.stopPropagation()
              onClose()
            }
          }}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} />
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        {canRename ? (
          <>
            <ContextMenuItem onSelect={onRequestRename}>
              <HugeiconsIcon icon={Edit02Icon} size={12} className="mr-2" />
              Rename
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}
        <ContextMenuItem onSelect={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} size={12} className="mr-2" />
          Close
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onCloseOthers}>Close others</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function TerminalTabBar() {
  const {
    sessions,
    activeTab,
    isOpen,
    setActiveTab,
    closeSession,
    closeOtherSessions,
    renameSession,
    togglePanel,
    openSession,
  } = useTerminalPanel()
  const systemsResult = useAtomValue(HubClient.query("systems.list", undefined))
  const systemsList = systemsResult._tag === "Success" ? systemsResult.value : []
  const [renameSignals, setRenameSignals] = useState<Record<string, number>>({})
  const requestRename = (id: string) =>
    setRenameSignals((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))

  const onlineAgents = systemsList.filter((system) => system.status === "online")

  const handleBarClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isOpen && !(event.target as HTMLElement).closest("button")) {
      togglePanel()
    }
  }

  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center border-b border-border bg-card",
        !isOpen && "cursor-pointer",
      )}
      onClick={handleBarClick}
    >
      <button
        className="flex h-full items-center gap-1.5 border-r border-border px-3 text-muted-foreground transition-colors hover:text-foreground"
        onClick={togglePanel}
        title={isOpen ? "Collapse terminal (Ctrl+`)" : "Expand terminal (Ctrl+`)"}
      >
        <HugeiconsIcon icon={TerminalIcon} size={13} />
        <span className="text-[11px] font-medium tracking-wide">TERMINAL</span>
        <HugeiconsIcon
          icon={isOpen ? ArrowDown01Icon : ArrowUp01Icon}
          size={11}
          className="ml-0.5"
        />
      </button>

      <div className="flex flex-1 items-center overflow-x-auto scrollbar-none">
        {sessions.map((tab) => (
          <TerminalTab
            key={tab.id}
            tab={tab}
            isActive={activeTab === tab.id}
            renameSignal={renameSignals[tab.id] ?? 0}
            onSelect={() => {
              setActiveTab(tab.id)
              if (!isOpen) togglePanel()
            }}
            onClose={() => closeSession(tab.id)}
            onCloseOthers={() => closeOtherSessions(tab.id)}
            onRename={(label) => renameSession(tab.id, label)}
            onRequestRename={() => requestRename(tab.id)}
          />
        ))}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-none border-l border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
          title="New terminal session"
        >
          <HugeiconsIcon icon={Add01Icon} size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-[11px]">Open Terminal</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {onlineAgents.length === 0 ? (
              <DropdownMenuItem disabled className="text-[11px]">
                No agents online
              </DropdownMenuItem>
            ) : (
              onlineAgents.map((system) => (
                <DropdownMenuItem
                  key={system.id}
                  className="text-[11px]"
                  onClick={() =>
                    openSession({
                      agentId: system.id,
                      mode: "shell",
                      label: system.hostname,
                    })
                  }
                >
                  <HugeiconsIcon icon={TerminalIcon} size={12} className="mr-2" />
                  {system.hostname}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function TerminalPanel({ className }: { className?: string }) {
  const { sessions, activeTab, isOpen } = useTerminalPanel()

  return (
    <div className={cn("flex flex-col border-t border-border bg-[#0d0d0d]", className)}>
      <TerminalTabBar />
      <div className={cn("flex-1 overflow-hidden", !isOpen && "hidden")}>
        {sessions.length === 0 ? (
          <EmptyTerminalState />
        ) : (
          sessions.map((tab) => (
            <div
              key={tab.id}
              className={cn("h-full w-full p-1", activeTab === tab.id ? "block" : "hidden")}
            >
              {tab.kind === "interactive" ? (
                <TerminalView agentId={tab.agentId} mode={tab.mode} className="h-full" />
              ) : (
                <OperatorProjectionView
                  className="h-full"
                  label={tab.label}
                  nodeId={tab.nodeId}
                  content={tab.content}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function EmptyTerminalState() {
  const { openSession } = useTerminalPanel()
  const systemsResult = useAtomValue(HubClient.query("systems.list", undefined))
  const systemsList = systemsResult._tag === "Success" ? systemsResult.value : []
  const onlineAgents = systemsList.filter((system) => system.status === "online")

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <HugeiconsIcon icon={TerminalIcon} size={28} className="text-muted-foreground/40" />
      <div>
        <p className="text-sm font-medium text-foreground">No terminal sessions</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Open a session from any system page, or connect to an agent below
        </p>
      </div>
      {onlineAgents.length > 0 ? (
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {onlineAgents.slice(0, 5).map((system) => (
            <Button
              key={system.id}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                openSession({
                  agentId: system.id,
                  mode: "shell",
                  label: system.hostname,
                })
              }
            >
              <HugeiconsIcon icon={TerminalIcon} size={12} className="mr-1.5" />
              {system.hostname}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
