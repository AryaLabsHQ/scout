import { Layer } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { BrowserSocket } from "@effect/platform-browser"

/**
 * The browser always reaches the hub same-origin at `/ws/rpc`: in production
 * the reverse proxy routes `/ws/*` to the hub (and Cloudflare Access attaches
 * the identity), and in development Vite proxies `/ws/rpc` to `SCOUT_HUB_URL`.
 * During SSR nothing connects; the URL is only a placeholder.
 */
const resolveHubWsUrl = (): string => {
  if (typeof window === "undefined") return "ws://127.0.0.1/ws/rpc"
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${window.location.host}/ws/rpc`
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
