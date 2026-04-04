import {
  HeadContent,
  Scripts,
  createRootRoute,
  Outlet,
} from "@tanstack/react-router"
import { Link, useRouterState } from "@tanstack/react-router"
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
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels"
import { BottomNav } from "@/components/bottom-nav"
import { ScoutProvider } from "@/providers/scout-provider"
import { useScout } from "@/providers/scout-provider"
import { TerminalProvider, useTerminalPanel } from "@/providers/terminal-provider"
import { TerminalPanel } from "@/components/terminal/terminal-panel"
import { cn } from "@/lib/utils"

import appCss from "@/styles.css?url"

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
  const { isConnected } = useScout()
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

  return (
    <SidebarInset className="pb-16 md:pb-0 overflow-hidden">
      <header className="flex h-12 items-center justify-between border-b border-border px-4 md:hidden">
        <span className="font-heading text-sm font-semibold tracking-wider">SCOUT</span>
        <ConnectionStatus />
      </header>
      <PanelGroup orientation="vertical" className="flex-1 h-full">
        <Panel defaultSize={isOpen ? 65 : 100} minSize={20}>
          <main className="h-full overflow-auto">
            <Outlet />
          </main>
        </Panel>
        {isOpen && (
          <>
            <PanelResizeHandle className="h-1 bg-border hover:bg-primary/40 transition-colors cursor-row-resize" />
            <Panel defaultSize={35} minSize={15} maxSize={70}>
              <TerminalPanel className="h-full" />
            </Panel>
          </>
        )}
      </PanelGroup>
    </SidebarInset>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────────

function AppLayout() {
  return (
    <ScoutProvider>
      <TerminalProvider>
        <SidebarProvider>
          <AppSidebar />
          <AppContent />
          <BottomNav />
        </SidebarProvider>
      </TerminalProvider>
    </ScoutProvider>
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
