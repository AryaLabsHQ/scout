import { useSyncExternalStore } from "react"

/**
 * Live state of the browser's `/ws/rpc` socket, fed by the HubClient protocol
 * (`src/rpc/protocol.ts`).
 *
 * - `connecting`: no socket has opened yet.
 * - `connected`: the socket is open.
 * - `disconnected`: the socket closed and the protocol is retrying.
 *
 * `unauthorized` latches once the hub answers any RPC with `Unauthorized`: the
 * Cloudflare Access session expired and only a reload (which goes back through
 * Access) can renew it.
 */
export interface HubConnectionState {
  readonly status: "connecting" | "connected" | "disconnected"
  /** When `status` last changed (ms since epoch). */
  readonly since: number
  readonly unauthorized: boolean
  /** When the last message arrived from the hub (ms since epoch), or null. */
  readonly lastMessageAt: number | null
}

let state: HubConnectionState = {
  status: "connecting",
  since: Date.now(),
  unauthorized: false,
  lastMessageAt: null,
}
const listeners = new Set<() => void>()

const update = (next: Partial<HubConnectionState>) => {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

export const hubConnection = {
  get: (): HubConnectionState => state,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  connected: () => update({ status: "connected", since: Date.now() }),
  disconnected: () => {
    if (state.status !== "disconnected") update({ status: "disconnected", since: Date.now() })
  },
  unauthorized: () => {
    if (!state.unauthorized) update({ unauthorized: true })
  },
  messageReceived: () => {
    state = { ...state, lastMessageAt: Date.now() }
  },
}

const SERVER_STATE: HubConnectionState = {
  status: "connecting",
  since: 0,
  unauthorized: false,
  lastMessageAt: null,
}

export function useHubConnection(): HubConnectionState {
  return useSyncExternalStore(hubConnection.subscribe, hubConnection.get, () => SERVER_STATE)
}

/**
 * True when a hub message is an RPC exit that failed with `Unauthorized`
 * (`ClientAuthMiddleware` rejected the call or ended the stream).
 */
export function isUnauthorizedExit(message: unknown): boolean {
  if (typeof message !== "object" || message === null) return false
  const record = message as { readonly _tag?: unknown; readonly exit?: unknown }
  if (record._tag !== "Exit" || typeof record.exit !== "object" || record.exit === null) return false
  const exit = record.exit as { readonly _tag?: unknown; readonly cause?: unknown }
  if (exit._tag !== "Failure" || !Array.isArray(exit.cause)) return false
  return exit.cause.some((reason: unknown) => {
    if (typeof reason !== "object" || reason === null) return false
    const fail = reason as { readonly _tag?: unknown; readonly error?: unknown }
    return (
      fail._tag === "Fail" &&
      typeof fail.error === "object" &&
      fail.error !== null &&
      (fail.error as { readonly _tag?: unknown })._tag === "Unauthorized"
    )
  })
}
