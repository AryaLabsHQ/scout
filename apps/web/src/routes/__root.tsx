import { useEffect } from "react"
import { HeadContent, Scripts, createRootRoute, Outlet } from "@tanstack/react-router"
import { fetchSystems } from "@/server/systems"
import { fetchAlerts } from "@/server/alerts"
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
  usePanelRef,
} from "react-resizable-panels"
import { BottomNav } from "@/components/bottom-nav"
import { AtomProvider } from "@/providers/atom-provider"
import { ConfirmProvider } from "@/providers/confirm-provider"
import { OperatorProvider, useOperator } from "@/providers/operator-provider"
import { TerminalProvider, useTerminalPanel } from "@/providers/terminal-provider"
import { CommandPaletteProvider } from "@/providers/command-palette-provider"
import { TerminalPanel } from "@/components/terminal/terminal-panel"
import { CommandPalette } from "@/components/command-palette"
import { SessionBanner } from "@/components/shell/connection"
import { TopBar } from "@/components/shell/top-bar"
import { cn } from "@/lib/utils"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { OperatorShell } from "@/components/operator/operator-shell"

import appCss from "@/styles.css?url"

if (import.meta.env.DEV) {
  import("react-grab")
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
    <div className="min-h-0 flex-1 overflow-hidden pb-16 md:pb-0">
      <PanelGroup orientation="vertical" className="h-full flex-1" id="scout-root">
        <Panel id="main-content" minSize="200px" className="!overflow-hidden">
          <main className="h-full overflow-auto scrollbar-thin">
            <Outlet />
          </main>
        </Panel>
        <PanelResizeHandle
          className={cn(
            "h-px bg-border transition-colors hover:bg-border-strong cursor-row-resize",
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
    </div>
  )
}

function OperatorDrawer() {
  const { isDrawerOpen, closeDrawer } = useOperator()

  return (
    <Sheet
      open={isDrawerOpen}
      onOpenChange={(open) => {
        if (!open) closeDrawer()
      }}
    >
      <SheetContent side="right" showCloseButton className="w-full max-w-none p-0 sm:max-w-xl">
        <SheetHeader className="sr-only">
          <SheetTitle>Operator Drawer</SheetTitle>
          <SheetDescription>Session list and operator workbench drawer.</SheetDescription>
        </SheetHeader>
        <OperatorShell variant="drawer" className="h-full" />
      </SheetContent>
    </Sheet>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────────

function AppLayout() {
  const { initialSystems, initialAlerts } = Route.useLoaderData()
  return (
    <AtomProvider initialState={{ systems: initialSystems, alerts: initialAlerts }}>
      <OperatorProvider>
        <TerminalProvider>
          <CommandPaletteProvider>
            <TooltipProvider>
              <ConfirmProvider>
                <div className="flex h-dvh flex-col">
                  <TopBar />
                  <SessionBanner />
                  <AppContent />
                </div>
                <BottomNav />
                <OperatorDrawer />
                <CommandPalette />
                <Toaster />
              </ConfirmProvider>
            </TooltipProvider>
          </CommandPaletteProvider>
        </TerminalProvider>
      </OperatorProvider>
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
