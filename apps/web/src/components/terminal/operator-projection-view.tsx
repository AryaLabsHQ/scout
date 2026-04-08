import { useEffect, useRef } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArtificialIntelligence04Icon, TerminalIcon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"

export function OperatorProjectionView({
  label,
  nodeId,
  content,
  className,
}: {
  label: string
  nodeId: string
  content: string
  className?: string
}) {
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!preRef.current) return
    preRef.current.scrollTop = preRef.current.scrollHeight
  }, [content])

  return (
    <div className={cn("flex h-full flex-col overflow-hidden bg-[#0d0d0d] text-[#d4d4d4]", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2 text-[11px]">
        <div className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon icon={ArtificialIntelligence04Icon} size={12} className="shrink-0 text-cyan-300" />
          <span className="truncate">{label}</span>
        </div>
        <div className="flex items-center gap-2 text-[#8a8a8a]">
          <HugeiconsIcon icon={TerminalIcon} size={12} />
          <span>{nodeId}</span>
          <span className="uppercase tracking-[0.18em]">Read-only</span>
        </div>
      </div>
      <pre
        ref={preRef}
        className="flex-1 overflow-auto px-3 py-3 font-mono text-[12px] leading-5 whitespace-pre-wrap"
      >
        {content.length > 0 ? content : "Operator terminal output will appear here once the mirrored run starts streaming."}
      </pre>
    </div>
  )
}
