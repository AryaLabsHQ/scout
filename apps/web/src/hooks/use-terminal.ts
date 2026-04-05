import { useEffect, useRef, useCallback } from "react"
import type { RefObject } from "react"
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

  // Build the stream atom for this session's params. The atom is stable as long
  // as params don't change (AtomRpc.query uses family keying by payload hash).
  const streamAtom = HubClient.query("terminal.open", {
    agentId,
    mode,
    cols: 80, // initial — will be resized by FitAddon after mount
    rows: 24,
    ...(podName ? { podName } : {}),
    ...(namespace ? { namespace } : {}),
  })

  // Mount the atom + get the pull-next setter.
  // Calling pull(undefined) advances the stream by one batch.
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

  // Process incoming stream chunks → terminal output
  const processChunk = useCallback((items: TerminalOutput[]) => {
    const term = termRef.current
    if (!term) return

    for (const chunk of items) {
      if (chunk._tag === "session-start") {
        sessionIdRef.current = chunk.sessionId
      } else if (chunk._tag === "output") {
        // Decode base64 PTY output
        try {
          const decoded = decodeURIComponent(escape(atob(chunk.dataBase64)))
          term.write(decoded)
        } catch {
          try {
            const bytes = Uint8Array.from(atob(chunk.dataBase64), (c) => c.charCodeAt(0))
            term.write(bytes)
          } catch {
            // ignore
          }
        }
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

      // Fit on container resize
      resizeObserver = new ResizeObserver(() => {
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

      // Kick off the first pull once the terminal is ready
      pullNext(undefined)
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
      fitAddon = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, mode, podName, namespace])

  return { termRef, sessionIdRef }
}
