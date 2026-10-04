/**
 * Session-end behavior of the shared duplex adapter
 * (packages/shared/src/rpc/duplex-socket.ts), exercised from the agent's
 * client role. `@scout/shared` has no test runner of its own.
 */

import { describe, expect, it } from "vitest"
import { Effect, Exit } from "effect"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Socket from "effect/socket/Socket"
import { AgentHubRpcs, makeDuplexRpcProtocols } from "@scout/shared"

const writeError = new Socket.SocketError({
  reason: new Socket.SocketWriteError({ cause: new Error("send failed") }),
})

const fakeSocket = (options: {
  readonly pull: Effect.Effect<never, Socket.SocketError>
  readonly write: Effect.Effect<void, Socket.SocketError>
}): Socket.Socket =>
  Socket.make({
    reader: Effect.succeed({
      pull: options.pull,
      upgrade: Socket.SocketUpgradeError.unsupported,
    }),
    writer: Effect.succeed({
      write: () => options.write,
      writeAll: () => options.write,
    }),
  })

const reportOnce = (socket: Socket.Socket) =>
  Effect.gen(function* () {
    const { clientProtocol, closed } = yield* makeDuplexRpcProtocols(socket)
    const client = yield* RpcClient.make(AgentHubRpcs).pipe(Effect.provide(clientProtocol))
    const report = yield* client["agent.reportPluginCollection"]({
      systemId: "test-agent",
      collection: {},
    }).pipe(Effect.timeout("2 seconds"), Effect.exit)
    return { report, reason: yield* closed }
  }).pipe(Effect.scoped, Effect.provide(RpcSerialization.layerNdjson))

describe("makeDuplexRpcProtocols", () => {
  it("fails writes once the socket has closed instead of suspending", async () => {
    // Socket.fromWebSocket suspends writes while disconnected; model that
    // with a write that never completes.
    const socket = fakeSocket({
      pull: Effect.fail(
        new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1006 }) }),
      ),
      write: Effect.never,
    })

    const { report, reason } = await Effect.runPromise(reportOnce(socket))

    expect(reason).toBe("SocketClosed")
    expect(Exit.isFailure(report)).toBe(true)
    expect(String(Exit.isFailure(report) && report.cause)).not.toContain("TimeoutError")
  })

  it("ends the session when a write fails", async () => {
    const socket = fakeSocket({ pull: Effect.never, write: Effect.fail(writeError) })

    const { report, reason } = await Effect.runPromise(reportOnce(socket))

    expect(reason).toBe("WriteFailed")
    expect(Exit.isFailure(report)).toBe(true)
  })
})
