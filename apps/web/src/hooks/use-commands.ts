import { useMemo } from "react"
import { useNavigate } from "@tanstack/react-router"
import {
  DashboardCircleIcon,
  ServerStack01Icon,
  Alert01Icon,
  TerminalIcon,
  Settings01Icon,
  Edit02Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import { useAtomValue } from "@effect/atom-react"
import { HubClient } from "@/rpc/client"
import { useTerminalPanel } from "@/providers/terminal-provider"

// ── Command type ──────────────────────────────────────────────────────────────

export type CommandGroup = "Navigation" | "Terminal" | "System" | "Alerts"

export interface Command {
  /** Stable unique id across renders */
  id: string
  /** Display label shown in the palette */
  label: string
  /** Group header in the palette */
  group: CommandGroup
  /** Extra fuzzy-search keywords (cmdk uses label + keywords) */
  keywords?: string[]
  /** Keyboard shortcut hint shown on the right (not bound automatically) */
  shortcut?: string
  /** Optional icon from hugeicons */
  icon?: IconSvgElement
  /** Action to run when the command is executed. Return false to keep the palette open. */
  perform: () => void | false
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Build the full command list based on current app state. This is the single
 * extension point for adding palette commands — new sources (systemd, alerts,
 * etc.) should be added here so all commands stay co-located.
 */
export function useCommands(): Command[] {
  const navigate = useNavigate()
  const systemsResult = useAtomValue(HubClient.query("systems.list", undefined))
  const systemsList = systemsResult._tag === "Success" ? systemsResult.value : []
  const {
    sessions,
    activeTab,
    isOpen,
    openSession,
    closeSession,
    setActiveTab,
    togglePanel,
  } = useTerminalPanel()

  return useMemo<Command[]>(() => { // eslint-disable-line react-hooks/exhaustive-deps
    const commands: Command[] = []

    // ── Navigation: static routes ─────────────────────────────────────────────
    const staticNav: Array<{ to: string; label: string; icon: IconSvgElement }> = [
      { to: "/overview", label: "Overview", icon: DashboardCircleIcon },
      { to: "/alerts", label: "Alerts", icon: Alert01Icon },
      { to: "/terminal", label: "Terminal", icon: TerminalIcon },
      { to: "/settings", label: "Settings", icon: Settings01Icon },
    ]
    for (const item of staticNav) {
      commands.push({
        id: `nav:${item.to}`,
        label: `Go to ${item.label}`,
        group: "Navigation",
        keywords: [item.label.toLowerCase(), item.to],
        icon: item.icon,
        // TanStack router's navigate typing is strict about `to` paths; the
        // paths above are all known routes, so the cast is safe.
        perform: () => void navigate({ to: item.to as "/" }),
      })
    }

    // ── Navigation: one entry per connected system ────────────────────────────
    for (const s of systemsList) {
      commands.push({
        id: `nav:system:${s.id}`,
        label: `Go to system: ${s.hostname}`,
        group: "Navigation",
        keywords: [s.id, s.hostname, "system", "detail"],
        icon: ServerStack01Icon,
        perform: () =>
          void navigate({
            to: "/systems/$systemId",
            params: { systemId: s.id },
          }),
      })
    }

    // ── Terminal: open a new shell on any online agent ───────────────────────
    const online = systemsList.filter((s) => s.status === "online")
    for (const s of online) {
      commands.push({
        id: `term:open:${s.id}`,
        label: `Open terminal: ${s.hostname}`,
        group: "Terminal",
        keywords: [s.hostname, "shell", "connect", "new"],
        icon: TerminalIcon,
        perform: () =>
          openSession({
            agentId: s.id,
            mode: "shell",
            label: s.hostname,
          }),
      })
    }

    // ── Terminal: focus an existing tab ──────────────────────────────────────
    for (const tab of sessions) {
      commands.push({
        id: `term:focus:${tab.id}`,
        label: `Focus tab: ${tab.label}`,
        group: "Terminal",
        keywords: [tab.label, tab.agentId, "focus", "switch"],
        icon: TerminalIcon,
        perform: () => {
          setActiveTab(tab.id)
          if (!isOpen) togglePanel()
        },
      })
    }

    // ── Terminal: panel + active-tab actions ─────────────────────────────────
    commands.push({
      id: "term:toggle-panel",
      label: isOpen ? "Hide terminal panel" : "Show terminal panel",
      group: "Terminal",
      keywords: ["panel", "toggle", "collapse", "expand"],
      shortcut: "Ctrl+`",
      icon: TerminalIcon,
      perform: togglePanel,
    })

    if (activeTab) {
      const active = sessions.find((t) => t.id === activeTab)
      if (active) {
        commands.push({
          id: "term:rename-active",
          label: `Rename active tab (${active.label})`,
          group: "Terminal",
          keywords: ["rename", "label", "edit"],
          icon: Edit02Icon,
          perform: () => {
            // Dispatch a custom event that the tab component listens for.
            // This keeps the command decoupled from React refs.
            window.dispatchEvent(
              new CustomEvent("scout:rename-active-tab", { detail: active.id }),
            )
            if (!isOpen) togglePanel()
          },
        })
        commands.push({
          id: "term:close-active",
          label: `Close active tab (${active.label})`,
          group: "Terminal",
          keywords: ["close", "remove"],
          icon: Cancel01Icon,
          perform: () => closeSession(active.id),
        })
      }
    }

    return commands
  }, [
    navigate,
    systemsList,
    sessions,
    activeTab,
    isOpen,
    openSession,
    closeSession,
    setActiveTab,
    togglePanel,
  ])
}
