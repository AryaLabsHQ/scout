import { useEffect, useMemo, useRef, useCallback } from "react"
import type { RefObject } from "react"
import { Effect, Stream } from "effect"
import type { TerminalMode, TerminalOutput } from "@scout/shared"
import type { Ghostty, Terminal as GhosttyTerminal } from "ghostty-web"
import { useAtomValue, useAtomSet } from "@effect/atom-react"
import { HubClient } from "@/rpc/client"

export interface UseTerminalOptions {
  containerRef: RefObject<HTMLDivElement | null>
  agentId: string
  mode: TerminalMode
  podName?: string
  namespace?: string
}

// Shared WASM loader — cached across all terminal instances
let ghosttyPromise: Promise<{ mod: typeof import("ghostty-web"); ghostty: Ghostty }> | undefined

function loadGhostty() {
  if (ghosttyPromise) return ghosttyPromise
  ghosttyPromise = import("ghostty-web")
    .then(async (mod) => ({ mod, ghostty: await mod.Ghostty.load() }))
    .catch((err) => {
      ghosttyPromise = undefined
      throw err
    })
  return ghosttyPromise
}

export function useTerminal({ containerRef, agentId, mode, podName, namespace }: UseTerminalOptions) {
  const sessionIdRef = useRef<string | null>(null)
  const termRef = useRef<GhosttyTerminal | null>(null)
  // Output chunks that arrived from the stream BEFORE the ghostty terminal
  // finished mounting. We buffer them here and flush once `termRef.current`
  // is set in the setup effect. Without this, the shell's initial banner +
  // prompt (which often arrive in the first pull, before WASM has loaded)
  // are lost and the user sees a blank terminal.
  const pendingOutputRef = useRef<string[]>([])

  // Build a fresh per-instance stream atom for this session.
  //
  // We deliberately bypass `HubClient.query("terminal.open", ...)` here for
  // two reasons:
  //
  //   1. `HubClient.query` is backed by `Atom.family`, which dedupes atoms
  //      structurally by payload. Two tabs on the same agent with the same
  //      initial `cols/rows` would collapse to a single stream atom —
  //      i.e., a single shared PTY session. Each tab needs its own session.
  //
  //   2. AtomRpc's internal `runtime.pull(...)` call does NOT pass
  //      `disableAccumulation: true`. As a result, each pull emits the
  //      CUMULATIVE list of items (`[s, a]`, then `[s, a, b]`, then
  //      `[s, a, b, c]`, …). Iterating `items` on every update writes every
  //      chunk over and over, which is the source of the "duplicated output"
  //      the terminal was exhibiting.
  //
  // By calling `HubClient.runtime.pull(...)` directly inside `useMemo`, each
  // tab gets a unique atom AND only sees the newly-arrived chunk per pull.
  const streamAtom = useMemo(
    () =>
      HubClient.runtime.pull(
        Stream.unwrap(
          HubClient.use((client) =>
            Effect.succeed(
              client("terminal.open", {
                agentId,
                mode,
                cols: 80, // initial — will be resized by FitAddon after mount
                rows: 24,
                ...(podName ? { podName } : {}),
                ...(namespace ? { namespace } : {}),
              }) as Stream.Stream<TerminalOutput, unknown>,
            ),
          ),
        ),
        { disableAccumulation: true },
      ),
    [agentId, mode, podName, namespace],
  )

  // Mount the atom + get the pull-next setter.
  // Calling pullNext(undefined) advances the stream by one chunk.
  const pullNext = useAtomSet(streamAtom)

  // Read the current pull result reactively
  const pullResult = useAtomValue(streamAtom)

  // Mutation atoms for sending input/resize/close
  const inputMutationAtom = HubClient.mutation("terminal.input")
  const resizeMutationAtom = HubClient.mutation("terminal.resize")
  const closeMutationAtom = HubClient.mutation("terminal.close")

  const runInput = useAtomSet(inputMutationAtom)
  const runResize = useAtomSet(resizeMutationAtom)
  const runClose = useAtomSet(closeMutationAtom)

  // Process incoming stream chunks → terminal output.
  //
  // With `disableAccumulation: true`, `items` contains only the NEW chunks
  // delivered by this pull (not the cumulative history). Iterating writes
  // each chunk exactly once per pull.
  //
  // IMPORTANT: `session-start` is handled even when `termRef.current` is
  // null, because it just records the session id — no terminal required.
  // Output chunks that arrive before the terminal has mounted are buffered
  // in `pendingOutputRef` and flushed once `termRef.current` is set.
  const processChunk = useCallback((items: readonly TerminalOutput[]) => {
    const term = termRef.current

    for (const chunk of items) {
      if (chunk._tag === "session-start") {
        sessionIdRef.current = chunk.sessionId
        continue
      }
      if (chunk._tag !== "output") continue

      // Decode base64 PTY output once, then either write or buffer.
      let decoded: string | Uint8Array
      try {
        decoded = decodeURIComponent(escape(atob(chunk.dataBase64)))
      } catch {
        try {
          decoded = Uint8Array.from(atob(chunk.dataBase64), (c) => c.charCodeAt(0))
        } catch {
          continue
        }
      }

      if (term) {
        term.write(decoded)
      } else if (typeof decoded === "string") {
        pendingOutputRef.current.push(decoded)
      } else {
        // Uint8Array path: decode to string for buffering. Ghostty accepts
        // both, but storing a string keeps the buffer uniform.
        pendingOutputRef.current.push(new TextDecoder().decode(decoded))
      }
    }
  }, [])

  // React to pull result changes: process items and pull next chunk
  useEffect(() => {
    if (pullResult._tag === "Success") {
      const { done, items } = pullResult.value
      processChunk(items)
      if (!done) {
        // Pull the next batch
        pullNext(undefined)
      }
    } else if (pullResult._tag === "Initial") {
      // Initial/waiting — no action needed, atom will update on next pull
    }
    // Initial: atom not yet started (will start when mounted by useAtomSet above)
    // Failure: stream error — terminal will remain as-is
  }, [pullResult, processChunk, pullNext])

  // Setup terminal UI and wire input/resize
  useEffect(() => {
    let isMounted = true
    let fitAddon: import("ghostty-web").FitAddon | null = null
    let dataDisposable: { dispose: () => void } | null = null
    let resizeDisposable: { dispose: () => void } | null = null
    let resizeObserver: ResizeObserver | null = null

    async function setup() {
      if (!containerRef.current || !isMounted) return

      const { mod, ghostty } = await loadGhostty()
      if (!isMounted || !containerRef.current) return

      const term = new mod.Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 13,
        fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
        allowTransparency: false,
        convertEol: true,
        scrollback: 10_000,
        ghostty,
        theme: {
          background: "#0d0d0d",
          foreground: "#d4d4d4",
          cursor: "#d4d4d4",
          cursorAccent: "#0d0d0d",
          black: "#1e1e1e",
          red: "#f44747",
          green: "#6a9955",
          yellow: "#d7ba7d",
          blue: "#569cd6",
          magenta: "#c678dd",
          cyan: "#4ec9b0",
          white: "#d4d4d4",
          brightBlack: "#6b6b6b",
          brightRed: "#f44747",
          brightGreen: "#b5cea8",
          brightYellow: "#ffd700",
          brightBlue: "#9cdcfe",
          brightMagenta: "#c678dd",
          brightCyan: "#4ec9b0",
          brightWhite: "#ffffff",
        },
      })

      fitAddon = new mod.FitAddon()
      term.loadAddon(fitAddon)
      term.open(containerRef.current)
      fitAddon.fit()
      termRef.current = term

      // Flush any output chunks that arrived from the stream before the
      // terminal was ready. These are typically the shell banner + first
      // prompt — without this flush the user sees a blank terminal even
      // though the PTY is streaming.
      if (pendingOutputRef.current.length > 0) {
        for (const buffered of pendingOutputRef.current) {
          term.write(buffered)
        }
        pendingOutputRef.current = []
      }

      // User input → hub via mutation atom
      dataDisposable = term.onData((data: string) => {
        const sessionId = sessionIdRef.current
        if (!sessionId) return
        const b64 = btoa(unescape(encodeURIComponent(data)))
        runInput({ payload: { sessionId, dataBase64: b64 } })
      })

      // Resize events → hub
      resizeDisposable = term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        const sessionId = sessionIdRef.current
        if (!sessionId) return
        runResize({ payload: { sessionId, cols, rows } })
      })

      // Fit on container resize.
      //
      // IMPORTANT: skip when the container is zero-sized. When the terminal
      // panel collapses we hide the view body with `display: none`, which
      // causes ResizeObserver to fire a callback with clientWidth/Height = 0.
      // If we called `fitAddon.fit()` at that point ghostty would resize the
      // terminal to 0×0 cols/rows and emit a resize event — which we'd then
      // forward to the agent as a bogus `terminal.resize` RPC, breaking any
      // curses app running in the shell. When the panel is re-expanded a
      // second resize fires with the real dimensions and we refit correctly.
      resizeObserver = new ResizeObserver(() => {
        const el = containerRef.current
        if (!el) return
        if (el.clientWidth === 0 || el.clientHeight === 0) return
        fitAddon?.fit()
      })
      if (containerRef.current) {
        resizeObserver.observe(containerRef.current)
      }

      // Copy handler
      term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        const key = event.key.toLowerCase()
        if (event.ctrlKey && event.shiftKey && key === "c") {
          const selection = term.getSelection()
          if (selection) navigator.clipboard.writeText(selection).catch(() => {})
          return true
        }
        if (event.metaKey && key === "c") {
          if (!term.hasSelection()) return true
          const selection = term.getSelection()
          if (selection) navigator.clipboard.writeText(selection).catch(() => {})
          return true
        }
        if (event.ctrlKey && key === "`") return true
        return false
      })

      // No explicit pullNext here: the pull atom auto-runs its first pull
      // when mounted (via `useAtomSet` above). The reaction effect then
      // drives subsequent pulls in response to each delivered chunk.
    }

    setup().catch(() => {})

    return () => {
      isMounted = false
      resizeObserver?.disconnect()
      dataDisposable?.dispose()
      resizeDisposable?.dispose()
      const sessionId = sessionIdRef.current
      if (sessionId) {
        runClose({ payload: { sessionId } })
      }
      termRef.current?.dispose()
      termRef.current = null
      sessionIdRef.current = null
      pendingOutputRef.current = []
      fitAddon = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, mode, podName, namespace])

  return { termRef, sessionIdRef }
}
