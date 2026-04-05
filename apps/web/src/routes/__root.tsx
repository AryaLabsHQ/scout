import { useEffect } from "react"
import {
  HeadContent,
  Scripts,
  createRootRoute,
  Outlet,
} from "@tanstack/react-router"
import { Link, useRouterState } from "@tanstack/react-router"
import { fetchSystems } from "@/server/systems"
import { fetchAlerts } from "@/server/alerts"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  DashboardCircleIcon,
  ServerStack01Icon,
  Alert01Icon,
  TerminalIcon,
  Settings01Icon,
  WifiConnected01Icon,
  WifiDisconnected01Icon,
} from "@hugeicons/core-free-icons"

import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
} from "@/components/ui/sidebar"
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
  usePanelRef,
} from "react-resizable-panels"
import { BottomNav } from "@/components/bottom-nav"
import { AtomProvider } from "@/providers/atom-provider"
import { TerminalProvider, useTerminalPanel } from "@/providers/terminal-provider"
import { CommandPaletteProvider } from "@/providers/command-palette-provider"
import { TerminalPanel } from "@/components/terminal/terminal-panel"
import { CommandPalette } from "@/components/command-palette"
import { cn } from "@/lib/utils"
import { Toaster } from "@/components/ui/sonner"
import { HubClient } from "@/rpc/client"
import { useAtomValue } from "@effect/atom-react"

import appCss from "@/styles.css?url"

if (import.meta.env.DEV) {
  import("react-grab")
}

// ── Nav items ─────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { to: "/overview", label: "Overview", icon: DashboardCircleIcon },
  { to: "/workloads", label: "Workloads", icon: ServerStack01Icon },
  { to: "/alerts", label: "Alerts", icon: Alert01Icon },
  { to: "/terminal", label: "Terminal", icon: TerminalIcon },
  { to: "/settings", label: "Settings", icon: Settings01Icon },
] as const

// ── Connection status ─────────────────────────────────────────────────────────

function ConnectionStatus() {
  // HubClient.runtime is an AtomRuntime; its layer atom reflects connection state.
  // We use the systems.list atom as a proxy: Success → connected, else → loading/offline.
  const systemsResult = useAtomValue(HubClient.query("systems.list", undefined))
  const isConnected = systemsResult._tag === "Success"

  return (
    <div className="flex items-center gap-1.5">
      <HugeiconsIcon
        icon={isConnected ? WifiConnected01Icon : WifiDisconnected01Icon}
        size={14}
        className={cn(isConnected ? "text-green-500" : "text-muted-foreground")}
      />
      <span className={cn("text-xs", isConnected ? "text-green-500" : "text-muted-foreground")}>
        {isConnected ? "Live" : "Offline"}
      </span>
    </div>
  )
}

// ── Desktop sidebar nav ───────────────────────────────────────────────────────

function AppSidebar() {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="font-heading text-sm font-semibold tracking-wider text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            SCOUT
          </span>
          <ConnectionStatus />
        </div>
      </SidebarHeader>
      <SidebarContent className="pt-2">
        <SidebarMenu>
          {NAV_ITEMS.map((item) => {
            const isActive =
              currentPath === item.to || currentPath.startsWith(item.to + "/")
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  render={<Link to={item.to} />}
                  isActive={isActive}
                  tooltip={item.label}
                >
                  <HugeiconsIcon icon={item.icon} size={18} />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarContent>
    </Sidebar>
  )
}

// ── Terminal panel with resize handle ─────────────────────────────────────────

function AppContent() {
  const { isOpen } = useTerminalPanel()
  const terminalPanelRef = usePanelRef()

  // Drive the panel's collapsed state from isOpen. The panel is always mounted
  // so react-resizable-panels can track its size; we just collapse/expand it.
  useEffect(() => {
    const panel = terminalPanelRef.current
    if (!panel) return
    if (isOpen && panel.isCollapsed()) {
      panel.expand()
    } else if (!isOpen && !panel.isCollapsed()) {
      panel.collapse()
    }
  }, [isOpen, terminalPanelRef])

  return (
    <SidebarInset className="pb-16 md:pb-0 overflow-hidden">
      <header className="flex h-12 items-center justify-between border-b border-border px-4 md:hidden">
        <span className="font-heading text-sm font-semibold tracking-wider">SCOUT</span>
        <ConnectionStatus />
      </header>
      <PanelGroup orientation="vertical" className="flex-1 h-full" id="scout-root">
        <Panel id="main-content" minSize="200px" className="!overflow-hidden">
          <main className="h-full overflow-auto">
            <Outlet />
          </main>
        </Panel>
        <PanelResizeHandle
          className={cn(
            "h-1 bg-border hover:bg-primary/40 transition-colors cursor-row-resize",
            !isOpen && "hidden",
          )}
        />
        <Panel
          id="terminal-panel"
          panelRef={terminalPanelRef}
          defaultSize="320px"
          minSize="120px"
          maxSize="70%"
          collapsible
          // When collapsed, keep the tab bar visible (36px = h-9 tab bar).
          // The body is hidden by the inner `{isOpen && ...}` guard.
          collapsedSize="36px"
          // `!` overrides the library's inline `overflow:auto` which otherwise
          // shows an empty scrollbar track on macOS.
          className="!overflow-hidden"
        >
          <TerminalPanel className="h-full" />
        </Panel>
      </PanelGroup>
    </SidebarInset>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────────

function AppLayout() {
  const { initialSystems, initialAlerts } = Route.useLoaderData()
  return (
    <AtomProvider initialState={{ systems: initialSystems, alerts: initialAlerts }}>
      <TerminalProvider>
        <CommandPaletteProvider>
          <SidebarProvider>
            <AppSidebar />
            <AppContent />
            <BottomNav />
            <CommandPalette />
            <Toaster />
          </SidebarProvider>
        </CommandPaletteProvider>
      </TerminalProvider>
    </AtomProvider>
  )
}

// ── Root route ────────────────────────────────────────────────────────────────

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Scout" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  /**
   * SSR loader — fetch initial systems + alerts via the hub's REST API so
   * the first client render paints with real data. The atom queries for
   * `systems.list` and `alerts.list` are seeded with these values in
   * `AtomProvider`, avoiding the 15s-ish convergence window that the old
   * WS-only state exhibited (see scratchpad M3-08).
   *
   * Loader failures (hub unreachable, etc.) degrade gracefully — both
   * server functions return empty arrays on error.
   */
  loader: async () => {
    const [initialSystems, initialAlerts] = await Promise.all([
      fetchSystems().catch(() => []),
      fetchAlerts().catch(() => []),
    ])
    return { initialSystems, initialAlerts }
  },
  shellComponent: RootDocument,
  component: AppLayout,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
