import { useEffect, useMemo, useState } from "react"
import {
  HeadContent,
  Scripts,
  createRootRoute,
  Outlet,
} from "@tanstack/react-router"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { fetchSystems } from "@/server/systems"
import { fetchAlerts } from "@/server/alerts"
import { HUB_URL } from "@/server/hub"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  Archive01Icon,
  ArrowDown01Icon,
  ArtificialIntelligence04Icon,
  DashboardCircleIcon,
  Delete01Icon,
  Edit02Icon,
  Alert01Icon,
  MoreHorizontalIcon,
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
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarInset,
} from "@/components/ui/sidebar"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
  usePanelRef,
} from "react-resizable-panels"
import { BottomNav } from "@/components/bottom-nav"
import { AtomProvider } from "@/providers/atom-provider"
import { OperatorProvider, useOperator } from "@/providers/operator-provider"
import { TerminalProvider, useTerminalPanel } from "@/providers/terminal-provider"
import { CommandPaletteProvider } from "@/providers/command-palette-provider"
import { TerminalPanel } from "@/components/terminal/terminal-panel"
import { CommandPalette } from "@/components/command-palette"
import { cn } from "@/lib/utils"
import { Toaster } from "@/components/ui/sonner"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { HubClient } from "@/rpc/client"
import { useAtomValue, useAtomSet } from "@effect/atom-react"
import { OperatorShell } from "@/components/operator/operator-shell"
import type { OperatorSessionSummary } from "@scout/shared"
import { SESSION_LIST_REACTIVITY_KEY } from "@/components/operator/operator-utils"

import appCss from "@/styles.css?url"

if (import.meta.env.DEV) {
  import("react-grab")
}

// ── Nav items ─────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { to: "/overview", label: "Overview", icon: DashboardCircleIcon },
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

function OperatorSidebarSection() {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const navigate = useNavigate()
  const { activeSessionId, optimisticSession, setActiveSessionId, setOptimisticSession } = useOperator()
  const sessionsResult = useAtomValue(HubClient.query("operator.sessions.list", undefined))
  const createSession = useAtomSet(HubClient.mutation("operator.sessions.create"), {
    mode: "promise",
  })
  const archiveSession = useAtomSet(HubClient.mutation("operator.sessions.archive"), {
    mode: "promise",
  })
  const deleteSession = useAtomSet(HubClient.mutation("operator.sessions.delete"), {
    mode: "promise",
  })
  const renameSession = useAtomSet(HubClient.mutation("operator.sessions.setTitle"), {
    mode: "promise",
  })

  const persistedSessions: ReadonlyArray<OperatorSessionSummary> = useMemo(
    () => (sessionsResult._tag === "Success" ? sessionsResult.value : []),
    [sessionsResult],
  )

  const [hiddenSessionIds, setHiddenSessionIds] = useState<ReadonlySet<string>>(new Set())

  // Merge optimistic session + filter hidden (deleted/archived) for immediate sidebar updates
  const sessions = useMemo(() => {
    let list = persistedSessions
    if (optimisticSession) {
      const alreadyPresent = list.some((s) => s.id === optimisticSession.session.id)
      if (!alreadyPresent) list = [optimisticSession.session, ...list]
    }
    if (hiddenSessionIds.size > 0) {
      list = list.filter((s) => !hiddenSessionIds.has(s.id))
    }
    return list
  }, [optimisticSession, persistedSessions, hiddenSessionIds])

  const isOperatorActive = currentPath === "/operator" || currentPath.startsWith("/operator/")
  const [isOpen, setIsOpen] = useState(isOperatorActive)
  const [isCreating, setIsCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")

  // Clear hidden set when the query refetches
  useEffect(() => {
    if (hiddenSessionIds.size > 0 && sessionsResult._tag === "Success") {
      setHiddenSessionIds(new Set())
    }
  }, [sessionsResult, hiddenSessionIds.size])

  const handleQuickCreate = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isCreating) return
    setIsCreating(true)
    try {
      const next = await createSession({
        payload: {},
        reactivityKeys: [SESSION_LIST_REACTIVITY_KEY],
      })
      setOptimisticSession(next)
      setActiveSessionId(next.session.id)
      void navigate({
        to: "/operator/$sessionId",
        params: { sessionId: next.session.id },
      })
    } finally {
      setIsCreating(false)
    }
  }

  const handleArchive = async (sid: string) => {
    setHiddenSessionIds((prev) => new Set(prev).add(sid))
    if (activeSessionId === sid) setActiveSessionId(null)
    await archiveSession({
      payload: { sessionId: sid },
      reactivityKeys: [SESSION_LIST_REACTIVITY_KEY],
    })
  }

  const handleDelete = async (sid: string) => {
    setHiddenSessionIds((prev) => new Set(prev).add(sid))
    if (activeSessionId === sid) setActiveSessionId(null)
    setDeleteTarget(null)
    await deleteSession({
      payload: { sessionId: sid },
      reactivityKeys: [SESSION_LIST_REACTIVITY_KEY],
    })
  }

  const handleStartRename = (sid: string, currentTitle: string) => {
    setRenamingSessionId(sid)
    setRenameValue(currentTitle)
  }

  const handleFinishRename = async () => {
    if (!renamingSessionId || !renameValue.trim()) {
      setRenamingSessionId(null)
      return
    }
    await renameSession({
      payload: { sessionId: renamingSessionId, title: renameValue.trim() },
      reactivityKeys: [SESSION_LIST_REACTIVITY_KEY],
    })
    setRenamingSessionId(null)
  }

  return (
    <SidebarMenuItem className={isOperatorActive ? "bg-sidebar-accent rounded-none" : ""}>
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this operator session and all its history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { if (deleteTarget) void handleDelete(deleteTarget) }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center">
          <SidebarMenuButton
            render={<Link to="/operator" />}
            isActive={isOperatorActive}
            tooltip="Operator"
            onClick={() => setActiveSessionId(null)}
            className={cn("flex-1", isOperatorActive && "border-l-2 border-green-500 bg-transparent hover:bg-transparent")}
          >
            <HugeiconsIcon icon={ArtificialIntelligence04Icon} size={18} className="text-green-500" />
            <span className="flex-1">Operator</span>
          </SidebarMenuButton>
          <CollapsibleTrigger
            render={
              <button
                type="button"
                className="flex size-5 shrink-0 items-center justify-center text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden"
              />
            }
          >
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={14}
              className={cn("transition-transform", isOpen && "rotate-180")}
            />
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="icon-sm"
            className="mr-1 size-5 shrink-0 text-sidebar-foreground group-data-[collapsible=icon]:hidden"
            disabled={isCreating}
            onClick={handleQuickCreate}
          >
            <HugeiconsIcon icon={Add01Icon} size={14} />
            <span className="sr-only">New operator session</span>
          </Button>
        </div>
        <CollapsibleContent>
          <SidebarMenuSub className="!mx-0 border-l-0 !px-1">
            {sessions.length === 0 ? (
              <SidebarMenuSubItem>
                <span className="px-2 py-1 text-[11px] text-muted-foreground">
                  No sessions
                </span>
              </SidebarMenuSubItem>
            ) : (
              sessions.map((session) => {
                const isSessionActive = isOperatorActive && activeSessionId === session.id
                const isRenaming = renamingSessionId === session.id
                return (
                  <SidebarMenuSubItem key={session.id} className="group/session">
                    <ContextMenu>
                      <ContextMenuTrigger>
                        <div className="flex items-center">
                          <SidebarMenuSubButton
                            isActive={isSessionActive}
                            render={<Link to="/operator/$sessionId" params={{ sessionId: session.id }} />}
                            onClick={() => setActiveSessionId(session.id)}
                            className={cn(
                              "flex-1 min-w-0",
                              isSessionActive && "border-l-2 border-green-500",
                            )}
                          >
                            <span
                              className={cn(
                                "inline-block size-1.5 shrink-0 rounded-full",
                                session.status === "active"
                                  ? "bg-green-500"
                                  : session.status === "waiting_for_user"
                                    ? "bg-yellow-500"
                                    : "bg-muted-foreground",
                              )}
                            />
                            {isRenaming ? (
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onBlur={() => void handleFinishRename()}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void handleFinishRename()
                                  if (e.key === "Escape") setRenamingSessionId(null)
                                }}
                                onClick={(e) => e.preventDefault()}
                                className="w-full truncate bg-transparent text-sm outline-none"
                              />
                            ) : (
                              <span className="truncate">{session.title}</span>
                            )}
                          </SidebarMenuSubButton>
                          {!isRenaming && (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <button
                                    type="button"
                                    className="mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted/60 group-hover/session:opacity-100"
                                    onClick={(e) => e.preventDefault()}
                                  />
                                }
                              >
                                <HugeiconsIcon icon={MoreHorizontalIcon} size={12} />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-36">
                                <DropdownMenuItem onClick={() => handleStartRename(session.id, session.title)}>
                                  <HugeiconsIcon icon={Edit02Icon} size={14} />
                                  Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => void handleArchive(session.id)}>
                                  <HugeiconsIcon icon={Archive01Icon} size={14} />
                                  Archive
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => setDeleteTarget(session.id)}
                                >
                                  <HugeiconsIcon icon={Delete01Icon} size={14} />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => handleStartRename(session.id, session.title)}>
                          <HugeiconsIcon icon={Edit02Icon} size={14} />
                          Rename
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => void handleArchive(session.id)}>
                          <HugeiconsIcon icon={Archive01Icon} size={14} />
                          Archive
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          variant="destructive"
                          onClick={() => setDeleteTarget(session.id)}
                        >
                          <HugeiconsIcon icon={Delete01Icon} size={14} />
                          Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  </SidebarMenuSubItem>
                )
              })
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )
}

function AppSidebar() {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const { openDrawer } = useOperator()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="font-heading text-sm font-semibold tracking-wider text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            SCOUT
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => openDrawer()}
              className="text-sidebar-foreground"
            >
              <HugeiconsIcon icon={ArtificialIntelligence04Icon} size={15} />
              <span className="sr-only">Open operator</span>
            </Button>
            <ConnectionStatus />
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="pt-2">
        <SidebarMenu>
          {NAV_ITEMS.filter((item) => item.to === "/overview").map((item) => {
            const isActive =
              currentPath === item.to || currentPath.startsWith(item.to + "/")
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  render={<Link to={item.to} />}
                  isActive={isActive}
                  tooltip={item.label}
                  className={isActive ? "border-l-2 border-green-500" : ""}
                >
                  <HugeiconsIcon icon={item.icon} size={18} />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
          <OperatorSidebarSection />
          {NAV_ITEMS.filter((item) => item.to !== "/overview").map((item) => {
            const isActive =
              currentPath === item.to || currentPath.startsWith(item.to + "/")
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  render={<Link to={item.to} />}
                  isActive={isActive}
                  tooltip={item.label}
                  className={isActive ? "border-l-2 border-green-500" : ""}
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
  const { openDrawer } = useOperator()
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
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={() => openDrawer()}>
            <HugeiconsIcon icon={ArtificialIntelligence04Icon} size={15} />
            <span className="sr-only">Open operator</span>
          </Button>
          <ConnectionStatus />
        </div>
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

function OperatorDrawer() {
  const { isDrawerOpen, closeDrawer } = useOperator()

  return (
    <Sheet
      open={isDrawerOpen}
      onOpenChange={(open) => {
        if (!open) closeDrawer()
      }}
    >
      <SheetContent
        side="right"
        showCloseButton
        className="w-full max-w-none p-0 sm:max-w-xl"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Operator Drawer</SheetTitle>
          <SheetDescription>
            Session list and operator workbench drawer.
          </SheetDescription>
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
            <SidebarProvider>
              <AppSidebar />
              <AppContent />
              <BottomNav />
              <OperatorDrawer />
              <CommandPalette />
              <Toaster />
            </SidebarProvider>
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
        <script
          // Inject the hub URL for the client-side RPC protocol to pick up.
          // protocol.ts reads `window.__SCOUT_HUB_URL__` and converts to ws://.
          dangerouslySetInnerHTML={{
            __html: `window.__SCOUT_HUB_URL__=${JSON.stringify(HUB_URL)};`,
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
