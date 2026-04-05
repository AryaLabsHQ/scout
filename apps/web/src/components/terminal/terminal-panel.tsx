import { useEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
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

// ── Single tab ────────────────────────────────────────────────────────────────

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

  const startEdit = () => {
    setDraft(tab.label)
    setEditing(true)
  }

  // External rename trigger (from context menu)
  useEffect(() => {
    if (renameSignal > 0) startEdit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameSignal])

  // External rename trigger (from command palette via window event)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (detail === tab.id) startEdit()
    }
    window.addEventListener("scout:rename-active-tab", handler)
    return () => window.removeEventListener("scout:rename-active-tab", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  useEffect(() => {
    if (editing) {
      // Defer to next frame so we win against any focus restore from a closing
      // context menu (Base UI restores focus to the trigger on close).
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
            onDoubleClick={(e) => {
              e.stopPropagation()
              startEdit()
            }}
            className={cn(
              "flex items-center gap-1.5 px-3 h-9 text-[11px] border-r border-border whitespace-nowrap transition-colors",
              isActive
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50",
            )}
          />
        }
      >
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === "Enter") commit()
                else if (e.key === "Escape") cancel()
              }}
              onBlur={commit}
              className="bg-transparent text-[11px] outline-none border-b border-primary/60 max-w-[160px] min-w-[40px]"
              style={{ width: `${Math.max(draft.length, 4)}ch` }}
            />
          ) : (
            <span className="max-w-[160px] truncate">{tab.label}</span>
          )}
          <span
            role="button"
            tabIndex={0}
            className="ml-0.5 rounded hover:text-red-400 focus:outline-none"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation()
                onClose()
              }
            }}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={11} />
          </span>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onSelect={onRequestRename}>
          <HugeiconsIcon icon={Edit02Icon} size={12} className="mr-2" />
          Rename
        </ContextMenuItem>
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

// ── Tab bar ───────────────────────────────────────────────────────────────────

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

  // Per-tab signal that bumps to trigger an external rename (from context menu)
  const [renameSignals, setRenameSignals] = useState<Record<string, number>>({})
  const requestRename = (id: string) =>
    setRenameSignals((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))

  const onlineAgents = systemsList.filter((s) => s.status === "online")

  // When collapsed, clicking any empty area of the tab bar expands the panel.
  // We skip if the click target is inside a button (tabs, toggle, + dropdown)
  // because those have their own handlers. This is more reliable than
  // stopPropagation, which Base UI's internal handlers sometimes bypass.
  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isOpen && !(e.target as HTMLElement).closest("button")) {
      togglePanel()
    }
  }

  return (
    <div
      className={cn(
        "flex h-9 items-center border-b border-border bg-card shrink-0",
        !isOpen && "cursor-pointer",
      )}
      onClick={handleBarClick}
    >
      {/* Collapse/expand toggle */}
      <button
        className="flex items-center gap-1.5 px-3 h-full text-muted-foreground hover:text-foreground transition-colors border-r border-border"
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

      {/* Session tabs */}
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

      {/* New session button */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-9 w-9 items-center justify-center rounded-none border-l border-border bg-card text-muted-foreground transition-colors hover:text-foreground shrink-0"
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
              onlineAgents.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  className="text-[11px]"
                  onClick={() =>
                    openSession({
                      agentId: s.id,
                      mode: "shell",
                      label: s.hostname,
                    })
                  }
                >
                  <HugeiconsIcon icon={TerminalIcon} size={12} className="mr-2" />
                  {s.hostname}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ── Panel body ────────────────────────────────────────────────────────────────

export function TerminalPanel({ className }: { className?: string }) {
  const { sessions, activeTab, isOpen } = useTerminalPanel()

  return (
    <div className={cn("flex flex-col border-t border-border bg-[#0d0d0d]", className)}>
      <TerminalTabBar />

      {/* Terminal body — keep mounted across collapse/expand and tab switches.
       *
       * Previously this was guarded with `{isOpen && ...}`, which unmounted
       * every TerminalView whenever the user collapsed the panel. That ran
       * each session's cleanup effect (runClose → agent kills PTY,
       * ghostty term disposed) and then re-mounted fresh components on
       * expand, spawning brand-new shells. The user lost cwd, shell
       * history, running processes, scrollback — every collapse/expand
       * cycle was a full reset.
       *
       * By switching to a CSS `hidden` toggle we keep all TerminalView
       * instances mounted across collapse/expand. React does NOT run effect
       * cleanup for `display: none`, so ghostty terms stay alive, PTY
       * sessions stay open on the agent, and expanding the panel restores
       * the exact state the user left behind.
       *
       * (Note: React's <Activity> component also hides via `display: none`
       * but explicitly tears down effects on hide — which is exactly what
       * we DON'T want here, so we use the plain CSS approach.)
       *
       * The inner `sessions.map` retains its per-tab visibility toggle so
       * only the active tab's view is actually visible when the panel is
       * open; all tabs' sessions remain alive in the background regardless.
       */}
      <div className={cn("flex-1 overflow-hidden", !isOpen && "hidden")}>
        {sessions.length === 0 ? (
          <EmptyTerminalState />
        ) : (
          sessions.map((tab) => (
            <div
              key={tab.id}
              className={cn(
                "h-full w-full p-1",
                activeTab === tab.id ? "block" : "hidden",
              )}
            >
              <TerminalView
                agentId={tab.agentId}
                mode={tab.mode}
                podName={tab.podName}
                namespace={tab.namespace}
                className="h-full"
              />
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
  const onlineAgents = systemsList.filter((s) => s.status === "online")

  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-6">
      <HugeiconsIcon icon={TerminalIcon} size={28} className="text-muted-foreground/40" />
      <div>
        <p className="text-sm font-medium text-foreground">No terminal sessions</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Open a session from any system page, or connect to an agent below
        </p>
      </div>
      {onlineAgents.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center mt-1">
          {onlineAgents.slice(0, 5).map((s) => (
            <Button
              key={s.id}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                openSession({
                  agentId: s.id,
                  mode: "shell",
                  label: s.hostname,
                })
              }
            >
              <HugeiconsIcon icon={TerminalIcon} size={12} className="mr-1.5" />
              {s.hostname}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
