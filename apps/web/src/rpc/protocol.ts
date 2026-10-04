import { Layer } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { BrowserSocket } from "@effect/platform-browser"

/**
 * Resolve the hub WebSocket URL:
 * - Client-side: from `window.__SCOUT_HUB_URL__` (injected by TanStack Start SSR)
 *   or derived from `window.location` (same-origin ws)
 * - Server-side (SSR): placeholder — the client reconnects on hydration
 */
const resolveHubWsUrl = (): string => {
  if (typeof window !== "undefined") {
    const injected = (window as Window & { __SCOUT_HUB_URL__?: string }).__SCOUT_HUB_URL__
    if (injected) {
      return injected.replace(/^http/, "ws") + "/ws/rpc"
    }
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
    return `${proto}//${window.location.host}/ws/rpc`
  }
  // SSR placeholder — won't actually connect during server render
  return "ws://localhost:3001/ws/rpc"
}

/**
 * HubProtocolLayer — provides RpcClient.Protocol over a WebSocket.
 * Composes:
 *   layerProtocolSocket (requires Socket + RpcSerialization → provides Protocol)
 *   + RpcSerialization.layerNdjson (provides RpcSerialization)
 *   + BrowserSocket.layerWebSocket (provides Socket)
 */
export const HubProtocolLayer: Layer.Layer<RpcClient.Protocol> = RpcClient.layerProtocolSocket().pipe(
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(BrowserSocket.layerWebSocket(resolveHubWsUrl())),
)
