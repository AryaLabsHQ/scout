import { useRef } from "react"
import type { TerminalMode } from "@scout/shared"
import { useTerminal } from "@/hooks/use-terminal"
import { cn } from "@/lib/utils"

export interface TerminalViewProps {
  agentId: string
  mode: TerminalMode
  className?: string
  onReady?: () => void
}

export function TerminalView({ agentId, mode, className }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  useTerminal({ containerRef, agentId, mode })

  return <div ref={containerRef} className={cn("h-full w-full overflow-hidden bg-[#0d0d0d]", className)} />
}
