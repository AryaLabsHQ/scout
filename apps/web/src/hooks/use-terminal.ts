import { useEffect, useRef } from "react"
import type { RefObject } from "react"
import type { TerminalMode } from "@scout/shared"
import type { Ghostty, Terminal as GhosttyTerminal } from "ghostty-web"
import { useScout } from "@/providers/scout-provider"

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
  const { invoke, onStreamEvent, isConnected } = useScout()
  const sessionIdRef = useRef<string | null>(null)
  const termRef = useRef<GhosttyTerminal | null>(null)

  useEffect(() => {
    if (!isConnected) return

    let cleanup: (() => void) | null = null
    let isMounted = true

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

      const fitAddon = new mod.FitAddon()
      term.loadAddon(fitAddon)
      term.open(containerRef.current)
      fitAddon.fit()
      termRef.current = term

      // Create session on hub
      let sessionId: string
      try {
        const result = await invoke("terminal.open", {
          agentId,
          mode,
          cols: term.cols,
          rows: term.rows,
          ...(podName ? { podName } : {}),
          ...(namespace ? { namespace } : {}),
        })
        sessionId = (result as { sessionId: string }).sessionId
        sessionIdRef.current = sessionId
      } catch (err) {
        term.write(`\r\n\x1b[31mFailed to open terminal session: ${String(err)}\x1b[0m\r\n`)
        return
      }

      // User input → hub
      const dataDisposable = term.onData((data: string) => {
        const b64 = btoa(unescape(encodeURIComponent(data)))
        invoke("terminal.input", {
          sessionId,
          dataBase64: b64,
        }).catch(() => {})
      })

      // Hub output → terminal
      const unsubOutput = onStreamEvent(sessionId, (event: unknown) => {
        const ev = event as { dataBase64?: string }
        if (ev?.dataBase64) {
          try {
            const decoded = decodeURIComponent(escape(atob(ev.dataBase64)))
            term.write(decoded)
          } catch {
            try {
              const bytes = Uint8Array.from(atob(ev.dataBase64), (c) => c.charCodeAt(0))
              term.write(bytes)
            } catch {
              // ignore
            }
          }
        }
      })

      // Resize
      const resizeDisposable = term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        invoke("terminal.resize", { sessionId, cols, rows }).catch(() => {})
      })

      // Fit on container resize
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit()
      })
      if (containerRef.current) {
        resizeObserver.observe(containerRef.current)
      }

      // Copy handler (Ctrl+Shift+C or Cmd+C)
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
        // Allow Ctrl+` to toggle terminal panel
        if (event.ctrlKey && key === "`") return true
        return false
      })

      cleanup = () => {
        isMounted = false
        resizeObserver.disconnect()
        dataDisposable.dispose()
        resizeDisposable.dispose()
        unsubOutput()
        invoke("terminal.close", { sessionId }).catch(() => {})
        term.dispose()
        termRef.current = null
        sessionIdRef.current = null
      }
    }

    setup().catch(() => {})

    return () => {
      isMounted = false
      cleanup?.()
    }
  }, [agentId, mode, podName, namespace, isConnected])

  return { termRef, sessionIdRef }
}
