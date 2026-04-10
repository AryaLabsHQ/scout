import { useEffect, useRef } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArtificialIntelligence04Icon, TerminalIcon } from "@hugeicons/core-free-icons"
import { loadGhostty } from "@/hooks/use-terminal"
import { cn } from "@/lib/utils"

export function OperatorProjectionView({
  label,
  nodeId,
  base64Chunks,
  className,
}: {
  label: string
  nodeId: string
  base64Chunks: string[]
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<any>(null)
  const writtenCountRef = useRef(0)

  // Load Ghostty WASM and create read-only terminal
  useEffect(() => {
    if (!containerRef.current) return
    let disposed = false

    loadGhostty().then(({ mod, ghostty }) => {
      if (disposed || !containerRef.current) return
      const term = new mod.Terminal({
        cursorBlink: false,
        fontSize: 12,
        fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", monospace',
        allowTransparency: false,
        convertEol: true,
        scrollback: 10_000,
        disableStdin: true,
        ghostty,
        theme: {
          background: "#0d0d0d",
          foreground: "#d4d4d4",
          cursor: "#d4d4d4",
          cursorAccent: "#0d0d0d",
          selectionBackground: "rgba(255,255,255,0.2)",
          black: "#1a1a1a",
          red: "#f87171",
          green: "#4ade80",
          yellow: "#facc15",
          blue: "#60a5fa",
          magenta: "#c084fc",
          cyan: "#22d3ee",
          white: "#d4d4d4",
          brightBlack: "#525252",
          brightRed: "#fca5a5",
          brightGreen: "#86efac",
          brightYellow: "#fde68a",
          brightBlue: "#93c5fd",
          brightMagenta: "#d8b4fe",
          brightCyan: "#67e8f9",
          brightWhite: "#f5f5f5",
        },
      })
      const fitAddon = new mod.FitAddon()
      term.loadAddon(fitAddon)
      term.open(containerRef.current)
      fitAddon.fit()
      termRef.current = term

      // Write any chunks that arrived before terminal was ready
      for (const chunk of base64Chunks) {
        try {
          const bytes = Uint8Array.from(atob(chunk), (c) => c.charCodeAt(0))
          term.write(bytes)
        } catch {
          // skip invalid base64
        }
      }
      writtenCountRef.current = base64Chunks.length

      // Observe container resize
      const observer = new ResizeObserver(() => {
        if (containerRef.current && containerRef.current.clientWidth > 0) {
          fitAddon.fit()
        }
      })
      observer.observe(containerRef.current)

      return () => observer.disconnect()
    })

    return () => {
      disposed = true
      termRef.current?.dispose()
      termRef.current = null
      writtenCountRef.current = 0
    }
  }, []) // mount once — don't recreate on chunk changes

  // Write new chunks as they stream in
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    for (let i = writtenCountRef.current; i < base64Chunks.length; i++) {
      try {
        const bytes = Uint8Array.from(atob(base64Chunks[i]), (c) => c.charCodeAt(0))
        term.write(bytes)
      } catch {
        // skip
      }
    }
    writtenCountRef.current = base64Chunks.length
  }, [base64Chunks])

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
      <div ref={containerRef} className="flex-1" />
    </div>
  )
}
