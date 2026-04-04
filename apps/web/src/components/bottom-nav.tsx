import { Link, useRouterState } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  DashboardCircleIcon,
  ServerStack01Icon,
  Alert01Icon,
  TerminalIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { to: "/overview", label: "Overview", icon: DashboardCircleIcon },
  { to: "/workloads", label: "Workloads", icon: ServerStack01Icon },
  { to: "/alerts", label: "Alerts", icon: Alert01Icon },
  { to: "/terminal", label: "Terminal", icon: TerminalIcon },
  { to: "/settings", label: "Settings", icon: Settings01Icon },
] as const

export function BottomNav() {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center border-t border-border bg-background md:hidden">
      {NAV_ITEMS.map((item) => {
        const isActive = currentPath === item.to || currentPath.startsWith(item.to + "/")
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors",
              isActive
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <HugeiconsIcon
              icon={item.icon}
              size={22}
              className={cn(isActive ? "text-primary" : "text-muted-foreground")}
            />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
