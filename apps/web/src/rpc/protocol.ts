import { Effect, Layer } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { BrowserSocket } from "@effect/platform-browser"
import { hubConnection, isUnauthorizedExit } from "@/lib/hub-connection"

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

/** Reports socket open/close to `hubConnection` (the top bar's live indicator). */
const ConnectionHooksLive = Layer.succeed(RpcClient.ConnectionHooks)({
  onConnect: Effect.sync(() => hubConnection.connected()),
  onDisconnect: Effect.sync(() => hubConnection.disconnected()),
})

/**
 * The socket protocol, with every message from the hub observed before it is
 * delivered, so an `Unauthorized` exit (expired Access session) can raise the
 * session-expired banner no matter which RPC hit it.
 */
const ObservedProtocol = Layer.effect(RpcClient.Protocol)(
  Effect.gen(function* () {
    const protocol = yield* RpcClient.makeProtocolSocket()
    return RpcClient.Protocol.of({
      ...protocol,
      run: (clientId, f) =>
        protocol.run(clientId, (message) => {
          hubConnection.messageReceived()
          if (isUnauthorizedExit(message)) hubConnection.unauthorized()
          return f(message)
        }),
    })
  }),
)

/**
 * HubProtocolLayer — provides RpcClient.Protocol over a WebSocket.
 * Composes:
 *   the observed socket protocol (requires Socket + RpcSerialization + ConnectionHooks)
 *   + RpcSerialization.layerNdjson
 *   + BrowserSocket.layerWebSocket
 */
export const HubProtocolLayer: Layer.Layer<RpcClient.Protocol> = ObservedProtocol.pipe(
  Layer.provide(ConnectionHooksLive),
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(BrowserSocket.layerWebSocket(resolveHubWsUrl())),
)
