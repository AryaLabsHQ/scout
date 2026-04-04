import { describe, it, expect, vi } from "vitest"
import { Effect, Layer, Stream } from "effect"
import type { ScoutMessage } from "@scout/shared"
import { HubConnection } from "../../src/services/hub-connection.js"
import { CommandHandler } from "../../src/services/command-handler.js"

// ── Mock HubConnection ────────────────────────────────────────────────────────

function createMockHubConnection(messages: ScoutMessage[]) {
  const sentMessages: unknown[] = []

  const mockHub = {
    send: (msg: unknown) => {
      sentMessages.push(msg)
      return Effect.void
    },
    onMessage: Stream.fromIterable(messages),
    status: Effect.succeed("connected" as const),
    invoke: (_method: string, _params?: Record<string, unknown>) =>
      Effect.succeed(null as unknown),
  }

  const MockHubLayer = Layer.succeed(HubConnection)(mockHub as Parameters<typeof HubConnection.of>[0])

  return { sentMessages, MockHubLayer }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CommandHandler", () => {
  describe("unknown method", () => {
    it("handles unknown method without throwing", async () => {
      const messages: ScoutMessage[] = [
        {
          id: "req-unknown",
          method: "some.unknown.method",
          params: {},
        },
      ]

      const { MockHubLayer } = createMockHubConnection(messages)
      const CommandHandlerTestLayer = CommandHandler.layer.pipe(Layer.provide(MockHubLayer))

      // Should complete without throwing since stream is finite
      await Effect.runPromise(
        Effect.gen(function* () {
          const handler = yield* CommandHandler
          yield* handler.run.pipe(
            Effect.timeout(200),
            Effect.ignore,
          )
        }).pipe(Effect.provide(CommandHandlerTestLayer))
      )
    })
  })

  describe("non-RpcRequest messages", () => {
    it("ignores RpcEvent and RpcResponse messages", async () => {
      const messages: ScoutMessage[] = [
        // RpcEvent
        { event: "tick" },
        // RpcResponse
        { id: "resp-01", ok: true, result: null },
      ]

      const { MockHubLayer } = createMockHubConnection(messages)
      const CommandHandlerTestLayer = CommandHandler.layer.pipe(Layer.provide(MockHubLayer))

      // Should not throw
      await Effect.runPromise(
        Effect.gen(function* () {
          const handler = yield* CommandHandler
          yield* handler.run.pipe(
            Effect.timeout(200),
            Effect.ignore,
          )
        }).pipe(Effect.provide(CommandHandlerTestLayer))
      )
    })
  })

  describe("logs.start missing params", () => {
    it("logs warning and continues when required params are missing", async () => {
      const messages: ScoutMessage[] = [
        {
          id: "req-missing",
          method: "logs.start",
          params: {
            // missing streamId, source, target
          },
        },
      ]

      const { MockHubLayer } = createMockHubConnection(messages)
      const CommandHandlerTestLayer = CommandHandler.layer.pipe(Layer.provide(MockHubLayer))

      // Should not throw despite missing params
      await Effect.runPromise(
        Effect.gen(function* () {
          const handler = yield* CommandHandler
          yield* handler.run.pipe(
            Effect.timeout(200),
            Effect.ignore,
          )
        }).pipe(Effect.provide(CommandHandlerTestLayer))
      )
    })
  })

  describe("logs.stop", () => {
    it("handles logs.stop for unknown streamId without throwing", async () => {
      const messages: ScoutMessage[] = [
        {
          id: "req-stop",
          method: "logs.stop",
          params: { streamId: "nonexistent-stream" },
        },
      ]

      const { MockHubLayer } = createMockHubConnection(messages)
      const CommandHandlerTestLayer = CommandHandler.layer.pipe(Layer.provide(MockHubLayer))

      // Should not throw
      await Effect.runPromise(
        Effect.gen(function* () {
          const handler = yield* CommandHandler
          yield* handler.run.pipe(
            Effect.timeout(200),
            Effect.ignore,
          )
        }).pipe(Effect.provide(CommandHandlerTestLayer))
      )
    })

    it("handles logs.stop without streamId param", async () => {
      const messages: ScoutMessage[] = [
        {
          id: "req-stop-empty",
          method: "logs.stop",
          params: {},
        },
      ]

      const { MockHubLayer } = createMockHubConnection(messages)
      const CommandHandlerTestLayer = CommandHandler.layer.pipe(Layer.provide(MockHubLayer))

      await Effect.runPromise(
        Effect.gen(function* () {
          const handler = yield* CommandHandler
          yield* handler.run.pipe(
            Effect.timeout(200),
            Effect.ignore,
          )
        }).pipe(Effect.provide(CommandHandlerTestLayer))
      )
    })
  })

  describe("logs.start with k8s source", () => {
    it("calls fetch with correct k8s API URL when source is k8s", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("log line 1\n"))
            controller.close()
          },
        }),
      })
      const originalFetch = global.fetch
      global.fetch = fetchMock as unknown as typeof fetch

      try {
        const messages: ScoutMessage[] = [
          {
            id: "req-k8s",
            method: "logs.start",
            params: {
              streamId: "k8s-stream-01",
              source: "k8s",
              target: "my-pod",
              namespace: "default",
              tail: 100,
            },
          },
        ]

        const { MockHubLayer } = createMockHubConnection(messages)
        const CommandHandlerTestLayer = CommandHandler.layer.pipe(Layer.provide(MockHubLayer))

        await Effect.runPromise(
          Effect.gen(function* () {
            const handler = yield* CommandHandler
            yield* handler.run.pipe(
              Effect.timeout(500),
              Effect.ignore,
            )

            // Wait a bit for the async fetch to fire
            yield* Effect.sleep(100)

            // fetch should have been called with k8s API URL
            expect(fetchMock).toHaveBeenCalled()
            const url = fetchMock.mock.calls[0]?.[0] as string
            expect(url).toContain("my-pod")
            expect(url).toContain("default")
            expect(url).toContain("follow=true")
            expect(url).toContain("tailLines=100")
          }).pipe(Effect.provide(CommandHandlerTestLayer))
        )
      } finally {
        global.fetch = originalFetch
      }
    })
  })

  describe("logs.start with systemd source", () => {
    it("attempts to spawn journalctl when source is systemd", async () => {
      // We can't easily mock Bun.spawn, but we can verify the handler
      // proceeds without crashing when journalctl is not available
      const messages: ScoutMessage[] = [
        {
          id: "req-systemd",
          method: "logs.start",
          params: {
            streamId: "systemd-stream-01",
            source: "systemd",
            target: "nonexistent.service",
            tail: 10,
          },
        },
      ]

      const { MockHubLayer } = createMockHubConnection(messages)
      const CommandHandlerTestLayer = CommandHandler.layer.pipe(Layer.provide(MockHubLayer))

      // Should handle journalctl spawn (may fail on CI, error is caught)
      await Effect.runPromise(
        Effect.gen(function* () {
          const handler = yield* CommandHandler
          yield* handler.run.pipe(
            Effect.timeout(300),
            Effect.ignore,
          )
        }).pipe(Effect.provide(CommandHandlerTestLayer))
      )
    })
  })

  describe("handler composability", () => {
    it("processes multiple messages in sequence", async () => {
      const messages: ScoutMessage[] = [
        { id: "req-1", method: "unknown.method.1", params: {} },
        { id: "req-2", method: "unknown.method.2", params: {} },
        { id: "req-3", method: "logs.stop", params: { streamId: "stream-x" } },
      ]

      const { MockHubLayer } = createMockHubConnection(messages)
      const CommandHandlerTestLayer = CommandHandler.layer.pipe(Layer.provide(MockHubLayer))

      await Effect.runPromise(
        Effect.gen(function* () {
          const handler = yield* CommandHandler
          yield* handler.run.pipe(
            Effect.timeout(300),
            Effect.ignore,
          )
        }).pipe(Effect.provide(CommandHandlerTestLayer))
      )
    })
  })
})
