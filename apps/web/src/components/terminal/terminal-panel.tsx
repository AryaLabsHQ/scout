import { HugeiconsIcon } from "@hugeicons/react"
import {
  TerminalIcon,
  Cancel01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Add01Icon,
} from "@hugeicons/core-free-icons"
import { useTerminalPanel } from "@/providers/terminal-provider"
import { useScout } from "@/providers/scout-provider"
import { TerminalView } from "./terminal-view"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TerminalTabBar() {
  const { sessions, activeTab, isOpen, setActiveTab, closeSession, togglePanel, openSession } =
    useTerminalPanel()
  const { systems } = useScout()

  const onlineAgents = Object.values(systems).filter((s) => s.system.status === "online")

  return (
    <div className="flex h-9 items-center border-b border-border bg-card shrink-0">
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
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id)
              if (!isOpen) togglePanel()
            }}
            className={cn(
              "flex items-center gap-1.5 px-3 h-9 text-[11px] border-r border-border whitespace-nowrap transition-colors",
              activeTab === tab.id
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            <span className="max-w-[120px] truncate">{tab.label}</span>
            <span
              role="button"
              tabIndex={0}
              className="ml-0.5 rounded hover:text-red-400 focus:outline-none"
              onClick={(e) => {
                e.stopPropagation()
                closeSession(tab.id)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation()
                  closeSession(tab.id)
                }
              }}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={11} />
            </span>
          </button>
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
          <DropdownMenuLabel className="text-[11px]">Open Terminal</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {onlineAgents.length === 0 ? (
            <DropdownMenuItem disabled className="text-[11px]">
              No agents online
            </DropdownMenuItem>
          ) : (
            onlineAgents.map((s) => (
              <DropdownMenuItem
                key={s.system.id}
                className="text-[11px]"
                onClick={() =>
                  openSession({
                    agentId: s.system.id,
                    mode: "shell",
                    label: s.system.hostname,
                  })
                }
              >
                <HugeiconsIcon icon={TerminalIcon} size={12} className="mr-2" />
                {s.system.hostname}
              </DropdownMenuItem>
            ))
          )}
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

      {/* Terminal views — keep all mounted, show only the active one */}
      {isOpen && (
        <div className="flex-1 overflow-hidden">
          {sessions.length === 0 ? (
            <EmptyTerminalState />
          ) : (
            sessions.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  "h-full w-full p-1",
                  activeTab === tab.id ? "block" : "hidden"
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
      )}
    </div>
  )
}

function EmptyTerminalState() {
  const { openSession } = useTerminalPanel()
  const { systems } = useScout()
  const onlineAgents = Object.values(systems).filter((s) => s.system.status === "online")

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
              key={s.system.id}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                openSession({
                  agentId: s.system.id,
                  mode: "shell",
                  label: s.system.hostname,
                })
              }
            >
              <HugeiconsIcon icon={TerminalIcon} size={12} className="mr-1.5" />
              {s.system.hostname}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
