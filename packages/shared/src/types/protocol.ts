// JSON-RPC style protocol over WebSocket
// Inspired by openclaw (RPC + tick) and cmux (method routing + stream IDs)

export interface RpcRequest {
  id: string
  method: string
  params?: Record<string, unknown>
}

export interface RpcResponse {
  id: string
  ok: boolean
  result?: unknown
  error?: RpcError
}

export interface RpcError {
  code: string
  message: string
}

export interface RpcEvent {
  event: string
  streamId?: string
  data?: unknown
  dataBase64?: string // for binary data (terminal output)
}

export type ScoutMessage = RpcRequest | RpcResponse | RpcEvent

// Type guards
export function isRpcRequest(msg: ScoutMessage): msg is RpcRequest {
  return "method" in msg && "id" in msg
}

export function isRpcResponse(msg: ScoutMessage): msg is RpcResponse {
  return "ok" in msg && "id" in msg
}

export function isRpcEvent(msg: ScoutMessage): msg is RpcEvent {
  return "event" in msg
}
