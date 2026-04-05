import { createFileRoute } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import { TerminalIcon } from "@hugeicons/core-free-icons"
import { useScout } from "@/providers/scout-provider"
import { useTerminalPanel } from "@/providers/terminal-provider"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export const Route = createFileRoute("/terminal")({ component: TerminalPage })

function TerminalPage() {
  const { systems } = useScout()
  const { sessions, openSession } = useTerminalPanel()

  const systemList = Object.values(systems)
  const onlineAgents = systemList.filter((s) => s.system.status === "online")
  const offlineAgents = systemList.filter((s) => s.system.status !== "online")

  const sessionCountFor = (agentId: string) =>
    sessions.filter((t) => t.agentId === agentId).length

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <HugeiconsIcon icon={TerminalIcon} size={18} className="text-foreground" />
          <h1 className="font-heading text-lg font-semibold">Terminal</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Open an interactive shell session on any connected agent. Sessions persist across navigation.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Tip: Press <kbd className="font-mono bg-muted px-1 rounded text-[10px]">Ctrl+`</kbd> to toggle the terminal panel.
        </p>
      </div>

      {systemList.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <HugeiconsIcon icon={TerminalIcon} size={32} className="text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No agents registered yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {onlineAgents.length > 0 && (
            <section>
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                Online Agents
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {onlineAgents.map((s) => (
                  <AgentCard
                    key={s.system.id}
                    hostname={s.system.hostname}
                    status="online"
                    sessionCount={sessionCountFor(s.system.id)}
                    onConnect={() =>
                      openSession({
                        agentId: s.system.id,
                        mode: "shell",
                        label: s.system.hostname,
                      })
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {offlineAgents.length > 0 && (
            <section>
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                Offline Agents
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {offlineAgents.map((s) => (
                  <AgentCard
                    key={s.system.id}
                    hostname={s.system.hostname}
                    status={s.system.status}
                    sessionCount={sessionCountFor(s.system.id)}
                    onConnect={() =>
                      openSession({
                        agentId: s.system.id,
                        mode: "shell",
                        label: s.system.hostname,
                      })
                    }
                    disabled
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function AgentCard({
  hostname,
  status,
  sessionCount,
  onConnect,
  disabled = false,
}: {
  hostname: string
  status: string
  sessionCount: number
  onConnect: () => void
  disabled?: boolean
}) {
  const hasSessions = sessionCount > 0
  return (
    <div className="flex items-center gap-3 rounded-none border border-border bg-card p-3 ring-1 ring-foreground/5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full shrink-0 ${
              status === "online" ? "bg-green-500" : "bg-muted-foreground/40"
            }`}
          />
          <p className="font-mono text-sm font-medium truncate">{hostname}</p>
        </div>
        <div className="mt-1 flex items-center gap-1">
          <Badge
            variant={status === "online" ? "secondary" : "outline"}
            className={`text-[9px] ${status === "online" ? "bg-green-500/10 text-green-500 border-green-500/20" : ""}`}
          >
            {status}
          </Badge>
          {hasSessions && (
            <Badge
              variant="outline"
              className="text-[9px] gap-1"
              title={`${sessionCount} open terminal session${sessionCount === 1 ? "" : "s"}`}
            >
              <HugeiconsIcon icon={TerminalIcon} size={9} />
              {sessionCount}
            </Badge>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs gap-1.5 shrink-0"
        disabled={disabled}
        onClick={onConnect}
      >
        <HugeiconsIcon icon={TerminalIcon} size={11} />
        {hasSessions ? "New terminal" : "Connect"}
      </Button>
    </div>
  )
}
