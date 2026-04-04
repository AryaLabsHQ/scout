import { useState, useEffect, useRef, useCallback } from "react"
import { useScout } from "@/providers/scout-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LogViewerProps {
  agentId: string
  source: "k8s" | "systemd"
  target: string
  namespace?: string
  container?: string
  tail?: number
  onClose: () => void
}

const TAIL_OPTIONS = [100, 500, 1000] as const
const MAX_LINES = 1000

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function highlightMatch(line: string, search: string): string {
  if (!search) return escapeHtml(line)
  const safe = escapeHtml(line)
  const safeSearch = escapeHtml(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return safe.replace(new RegExp(`(${safeSearch})`, "gi"), '<mark class="bg-yellow-400/40 text-foreground">$1</mark>')
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LogViewer({
  agentId,
  source,
  target,
  namespace,
  container,
  tail: initialTail = 100,
  onClose,
}: LogViewerProps) {
  const { invoke, onStreamEvent, isConnected } = useScout()

  const [lines, setLines] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [tail, setTail] = useState<number>(initialTail)
  const [streamId, setStreamId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const streamIdRef = useRef<string | null>(null)
  const autoScrollRef = useRef(autoScroll)

  useEffect(() => {
    autoScrollRef.current = autoScroll
  }, [autoScroll])

  // Auto-scroll when lines change
  useEffect(() => {
    if (autoScrollRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "instant" })
    }
  }, [lines])

  // Start / restart stream
  const startStream = useCallback(
    async (tailCount: number) => {
      if (!isConnected) {
        setError("Not connected to hub")
        return
      }

      // Stop previous stream if any
      if (streamIdRef.current) {
        invoke("logs.stop", { streamId: streamIdRef.current }).catch(() => {})
        streamIdRef.current = null
        setStreamId(null)
      }

      setLines([])
      setError(null)

      try {
        const params: Record<string, unknown> = {
          agentId,
          source,
          target,
          tail: tailCount,
        }
        if (namespace) params["namespace"] = namespace
        if (container) params["container"] = container

        const result = (await invoke("logs.start", params)) as { streamId: string }
        streamIdRef.current = result.streamId
        setStreamId(result.streamId)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start log stream")
      }
    },
    [agentId, source, target, namespace, container, invoke, isConnected]
  )

  // Subscribe to stream events when streamId is set
  useEffect(() => {
    if (!streamId) return

    const unsub = onStreamEvent(streamId, (data) => {
      const payload = data as { lines?: string[] }
      const newLines = payload.lines ?? []
      if (newLines.length === 0) return

      setLines((prev) => {
        const combined = [...prev, ...newLines]
        // Keep last MAX_LINES to prevent memory growth
        return combined.length > MAX_LINES ? combined.slice(-MAX_LINES) : combined
      })
    })

    return unsub
  }, [streamId, onStreamEvent])

  // Start on mount / reconnect
  useEffect(() => {
    if (isConnected) {
      startStream(tail)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamIdRef.current) {
        invoke("logs.stop", { streamId: streamIdRef.current }).catch(() => {})
        streamIdRef.current = null
      }
    }
  }, [invoke])

  // Scroll-lock detection
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40
    setAutoScroll(isAtBottom)
  }, [])

  const handleTailChange = (value: string | null) => {
    if (!value) return
    const newTail = Number(value)
    setTail(newTail)
    startStream(newTail)
  }

  const filteredLines = search
    ? lines.filter((l) => l.toLowerCase().includes(search.toLowerCase()))
    : lines

  const title = source === "k8s"
    ? `Pod: ${target}${namespace ? ` (${namespace})` : ""}${container ? ` / ${container}` : ""}`
    : `Unit: ${target}`

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="font-heading text-xs font-semibold flex-1 truncate">{title}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Tail selector */}
          <Select value={String(tail)} onValueChange={handleTailChange}>
            <SelectTrigger size="sm" className="h-6 w-20 text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TAIL_OPTIONS.map((t) => (
                <SelectItem key={t} value={String(t)}>
                  {t} lines
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Refresh */}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => startStream(tail)}
          >
            Refresh
          </Button>

          {/* Auto-scroll indicator */}
          <Button
            variant={autoScroll ? "default" : "outline"}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => {
              setAutoScroll(true)
              bottomRef.current?.scrollIntoView({ behavior: "smooth" })
            }}
          >
            {autoScroll ? "Live" : "Scroll to bottom"}
          </Button>

          {/* Close */}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-border px-3 py-1.5">
        <Input
          placeholder="Filter logs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-6 text-[11px] font-mono"
        />
      </div>

      {/* Log output */}
      <div className="relative flex-1 overflow-hidden">
        {error ? (
          <div className="flex items-center justify-center p-6 text-xs text-destructive">
            {error}
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="h-full overflow-y-auto"
            >
              <pre className="min-h-full p-3 font-mono text-[11px] leading-relaxed text-foreground">
                {filteredLines.length === 0 ? (
                  <span className="text-muted-foreground">
                    {streamId ? "Waiting for logs..." : "Connecting..."}
                  </span>
                ) : (
                  filteredLines.map((line, i) => (
                    <div
                      key={i}
                      dangerouslySetInnerHTML={{ __html: highlightMatch(line, search) }}
                    />
                  ))
                )}
              </pre>
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-2 border-t border-border px-3 py-1 text-[10px] text-muted-foreground">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${streamId ? "bg-green-500" : "bg-muted-foreground"}`}
        />
        <span>{streamId ? "Streaming" : "Stopped"}</span>
        <span className="ml-auto">{filteredLines.length} lines</span>
        {search && (
          <span className="text-yellow-500">{filteredLines.length} matching</span>
        )}
      </div>
    </div>
  )
}
