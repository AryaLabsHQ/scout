import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { Effect, Stream } from "effect"
import { useAtomValue, useAtomSet } from "@effect/atom-react"
import { HubClient } from "@/rpc/client"
import type { LogBatch } from "@scout/shared"
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
import type { LogsTailParams } from "@scout/shared"

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

// ── Inner component that owns the stream atom ─────────────────────────────────

interface LogStreamProps {
  params: LogsTailParams
  onClose: () => void
}

function LogStream({ params, onClose }: LogStreamProps) {
  const [search, setSearch] = useState("")
  const [tail, setTail] = useState<number>(params.tail ?? 100)
  const [lines, setLines] = useState<string[]>([])
  const [autoScroll, setAutoScroll] = useState(true)

  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(autoScroll)
  useEffect(() => { autoScrollRef.current = autoScroll }, [autoScroll])

  // Build a fresh per-instance log stream atom.
  //
  // We bypass `HubClient.query("logs.tail", ...)` for the same reasons as
  // `use-terminal.ts`:
  //   1. Family-dedupe would share one tail subscription across viewers.
  //   2. AtomRpc's internal stream pull does NOT pass `disableAccumulation`,
  //      so each pull would deliver the cumulative batch list — producing
  //      duplicated lines in the viewer.
  //
  // `HubClient.runtime.pull(..., { disableAccumulation: true })` gives us a
  // dedicated pull atom that emits only the newly-arrived batches per pull.
  const streamAtom = useMemo(
    () =>
      HubClient.runtime.pull(
        Stream.unwrap(
          HubClient.use((client) =>
            Effect.succeed(
              client("logs.tail", params) as Stream.Stream<LogBatch, unknown>,
            ),
          ),
        ),
        { disableAccumulation: true },
      ),
    [params],
  )
  const pullResult = useAtomValue(streamAtom)
  const pullNext = useAtomSet(streamAtom)

  // Auto-scroll when lines change
  useEffect(() => {
    if (autoScrollRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "instant" })
    }
  }, [lines])

  // React to pull results: append new lines and pull next batch
  useEffect(() => {
    if (pullResult._tag === "Success") {
      const { done, items } = pullResult.value
      const newLines = items.flatMap((batch) => batch.lines)
      if (newLines.length > 0) {
        setLines((prev) => {
          const combined = [...prev, ...newLines]
          return combined.length > MAX_LINES ? combined.slice(-MAX_LINES) : combined
        })
      }
      if (!done) {
        pullNext(undefined)
      }
    } else if (pullResult._tag === "Initial") {
      // waiting for next chunk — no action needed
    }
  }, [pullResult, pullNext])

  // No explicit initial pullNext: the pull atom auto-runs its first pull
  // when mounted (via `useAtomSet` above). The reaction effect then drives
  // subsequent pulls in response to each delivered batch.

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40)
  }, [])

  const filteredLines = search
    ? lines.filter((l) => l.toLowerCase().includes(search.toLowerCase()))
    : lines

  const isStreaming = pullResult._tag === "Success"
  const errorMsg = pullResult._tag === "Failure"
    ? "Log stream error — check agent connection"
    : null

  const title = params.source === "k8s"
    ? `Pod: ${params.target}${params.namespace ? ` (${params.namespace})` : ""}${params.container ? ` / ${params.container}` : ""}`
    : `Unit: ${params.target}`

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="font-heading text-xs font-semibold flex-1 truncate">{title}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Tail selector — changing this requires remounting with new params */}
          <Select value={String(tail)} onValueChange={(v) => setTail(Number(v))}>
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

          {/* Auto-scroll */}
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
        {errorMsg ? (
          <div className="flex items-center justify-center p-6 text-xs text-destructive">
            {errorMsg}
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
                    {isStreaming ? "Waiting for logs..." : "Connecting..."}
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
          className={`inline-block h-1.5 w-1.5 rounded-full ${isStreaming ? "bg-green-500" : "bg-muted-foreground"}`}
        />
        <span>{isStreaming ? "Streaming" : "Stopped"}</span>
        <span className="ml-auto">{filteredLines.length} lines</span>
        {search && (
          <span className="text-yellow-500">{filteredLines.length} matching</span>
        )}
      </div>
    </div>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

/**
 * LogViewer — mounts a `logs.tail` stream atom for the given target and
 * renders incoming log batches. The stream finalizes when the component
 * unmounts (the atom's scope closes automatically).
 */
export function LogViewer({
  agentId,
  source,
  target,
  namespace,
  container,
  tail = 100,
  onClose,
}: LogViewerProps) {
  // Build the params object — key for atom identity
  const params: LogsTailParams = {
    agentId,
    source,
    target,
    tail,
    ...(namespace ? { namespace } : {}),
    ...(container ? { container } : {}),
  }

  return <LogStream key={`${agentId}:${source}:${target}:${tail}`} params={params} onClose={onClose} />
}
