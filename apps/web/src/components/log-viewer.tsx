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
import type { PluginLogsParams } from "@scout/shared"

interface PluginLogViewerProps {
  params: PluginLogsParams
  /** Shows a Close button when given. */
  onClose?: () => void
  /** Header label; defaults to `<plugin>: <entity or stream>`. */
  title?: string
  /** Fixed height of the scrolling log body. */
  className?: string
}

export type LogViewerProps = PluginLogViewerProps

const TAIL_OPTIONS = [100, 200, 500, 1000] as const
const MAX_LINES = 1000

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function highlightMatch(line: string, search: string): string {
  if (!search) return escapeHtml(line)
  const safe = escapeHtml(line)
  const safeSearch = escapeHtml(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return safe.replace(new RegExp(`(${safeSearch})`, "gi"), '<mark class="bg-warn/30 text-foreground">$1</mark>')
}

// ── Inner component that owns the stream atom ─────────────────────────────────

interface LogStreamProps {
  params: PluginLogsParams
  tail: number
  onTailChange: (tail: number) => void
  onClose?: (() => void) | undefined
  title?: string | undefined
  className?: string | undefined
}

function LogStream({ params, tail, onTailChange, onClose, title: titleProp, className }: LogStreamProps) {
  const [search, setSearch] = useState("")
  const [lines, setLines] = useState<string[]>([])
  const [autoScroll, setAutoScroll] = useState(true)

  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(autoScroll)
  useEffect(() => { autoScrollRef.current = autoScroll }, [autoScroll])

  // Build a fresh per-instance log stream atom.
  //
  // We bypass `HubClient.query("plugins.logs", ...)` for the same reasons as
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
              client("plugins.logs", params) as Stream.Stream<LogBatch, unknown>,
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

  const title = titleProp ?? (params.entity?.id
    ? `${params.pluginId}: ${params.entity.id}`
    : `${params.pluginId}: ${params.streamId}`)

  return (
    <div className={`flex h-full flex-col bg-background ${className ?? ""}`}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className="flex-1 truncate font-mono text-xs text-muted-foreground">{title}</span>
        <Input
          placeholder="Filter…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 w-48 text-xs"
        />
        <Select value={String(tail)} onValueChange={(v) => onTailChange(Number(v))}>
          <SelectTrigger size="sm" className="h-7 w-28 text-xs">
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
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-xs"
          onClick={() => {
            setAutoScroll(true)
            bottomRef.current?.scrollIntoView({ behavior: "smooth" })
          }}
        >
          <span
            className={`inline-block size-2 rounded-full ${isStreaming && autoScroll ? "bg-ok live-pulse" : "bg-off"}`}
          />
          {autoScroll ? (isStreaming ? "Following" : "Stopped") : "Jump to latest"}
        </Button>
        {onClose ? (
          <Button variant="ghost" size="sm" className="text-xs" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {errorMsg ? (
          <div className="p-4 text-xs text-err">{errorMsg}</div>
        ) : (
          <ScrollArea className="h-full">
            <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto">
              <pre className="min-h-full px-4 py-3 font-mono text-xs leading-relaxed text-foreground">
                {filteredLines.length === 0 ? (
                  <span className="text-subtle">{isStreaming ? "Waiting for logs…" : "Connecting…"}</span>
                ) : (
                  filteredLines.map((line, i) => (
                    <div key={i} dangerouslySetInnerHTML={{ __html: highlightMatch(line, search) }} />
                  ))
                )}
              </pre>
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-4 py-1.5 text-[11px] text-subtle">
        <span className="ml-auto tabular">{filteredLines.length} lines</span>
        {search ? <span className="text-warn">{filteredLines.length} matching</span> : null}
      </div>
    </div>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

/**
 * LogViewer — mounts a `plugins.logs` stream atom for the given target and
 * renders incoming log batches. The stream finalizes when the component
 * unmounts (the atom's scope closes automatically).
 */
export function LogViewer({ onClose, params, title, className }: LogViewerProps) {
  const initialTail =
    typeof params.input === "object" && params.input !== null && typeof (params.input as Record<string, unknown>)["tail"] === "number"
      ? Number((params.input as Record<string, unknown>)["tail"])
      : 200
  // A tail picked in the selector applies to the target it was picked for; a new
  // target (or a new configured tail) starts from its own configured value.
  const targetKey = `${params.agentId}:${params.pluginId}:${params.streamId}:${params.entity?.id ?? ""}:${initialTail}`
  const [picked, setPicked] = useState<{ readonly target: string; readonly tail: number } | null>(null)
  const tail = picked?.target === targetKey ? picked.tail : initialTail
  const setTail = (next: number) => setPicked({ target: targetKey, tail: next })
  // Keyed on the params' content so an inline params object from the caller
  // does not restart the stream on every render; a new tail size does.
  const paramsKey = JSON.stringify(params)
  const streamParams = useMemo<PluginLogsParams>(
    () => {
      const base = JSON.parse(paramsKey) as PluginLogsParams
      const input = typeof base.input === "object" && base.input !== null ? base.input : {}
      return { ...base, input: { ...input, tail } }
    },
    [paramsKey, tail],
  )
  return (
    <LogStream
      key={`plugin:${params.agentId}:${params.pluginId}:${params.streamId}:${params.entity?.id ?? "none"}:${tail}`}
      params={streamParams}
      tail={tail}
      onTailChange={setTail}
      onClose={onClose}
      title={title}
      className={className}
    />
  )
}
