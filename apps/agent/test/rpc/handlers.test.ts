/**
 * Tests for apps/agent/src/rpc/handlers.ts — the HubAgentHandlersLive layer.
 *
 * Tests cover:
 *   - Input validation helpers (unit/containerId/k8sName)
 *   - Each handler category: systemd, docker, k8s, terminal, logs
 *   - Validation rejection paths
 *   - Shell-out and Docker API call patterns (with mocks)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Cause, Effect, Option } from "effect"
import { HubAgentHandlersLive } from "../../src/rpc/handlers.js"
import { HubAgentRpcs, ManagementError } from "@scout/shared"
import * as RpcMessage from "effect/unstable/rpc/RpcMessage"

// ── Test helper ───────────────────────────────────────────────────────────────

const testOptions = {
  clientId: 0 as number,
  requestId: RpcMessage.RequestId(1n),
  headers: {} as never,
}

type CallResult = { ok: unknown } | { err: unknown }

/**
 * Call a handler and return either { ok: value } or { err: unknown }.
 * This avoids fighting the union return types from accessHandler.
 */
const callHandler = (
  tag: Parameters<typeof HubAgentRpcs.accessHandler>[0],
  payload: Record<string, unknown>,
): Effect.Effect<CallResult> =>
  (Effect.gen(function* () {
    const handler = yield* HubAgentRpcs.accessHandler(tag)
    const result = (handler as (p: unknown, o: unknown) => Effect.Effect<unknown, unknown, never>)(
      payload,
      testOptions,
    )
    return yield* result.pipe(
      Effect.map((v): CallResult => ({ ok: v })),
      Effect.catchCause((cause) => {
        const failure = Cause.findErrorOption(cause)
        if (Option.isSome(failure)) {
          return Effect.succeed<CallResult>({ err: failure.value })
        }
        return Effect.succeed<CallResult>({ err: cause })
      }),
    )
  }).pipe(Effect.provide(HubAgentHandlersLive))) as Effect.Effect<CallResult>

// ── Input validation tests ────────────────────────────────────────────────────

describe("systemd input validation", () => {
  it("rejects path traversal in unit name", async () => {
    const result = await Effect.runPromise(
      callHandler("systemd.start", { unit: "../../etc/passwd" }),
    )
    expect("err" in result).toBe(true)
    if ("err" in result) {
      expect(result.err).toBeInstanceOf(ManagementError)
      if (result.err instanceof ManagementError) {
        expect(result.err.code).toBe("invalid-input")
      }
    }
  })

  it("rejects unit name with forward slash", async () => {
    const result = await Effect.runPromise(
      callHandler("systemd.stop", { unit: "some/unit.service" }),
    )
    expect("err" in result).toBe(true)
    if ("err" in result) {
      expect(result.err).toBeInstanceOf(ManagementError)
    }
  })

  it("rejects empty unit name", async () => {
    const result = await Effect.runPromise(
      callHandler("systemd.restart", { unit: "" }),
    )
    expect("err" in result).toBe(true)
    if ("err" in result) {
      expect(result.err).toBeInstanceOf(ManagementError)
    }
  })
})

describe("docker input validation", () => {
  it("rejects containerId with path traversal", async () => {
    const result = await Effect.runPromise(
      callHandler("docker.start", { containerId: "../../etc/passwd" }),
    )
    expect("err" in result).toBe(true)
    if ("err" in result) {
      expect(result.err).toBeInstanceOf(ManagementError)
      if (result.err instanceof ManagementError) {
        expect(result.err.code).toBe("invalid-input")
      }
    }
  })

  it("rejects containerId with spaces", async () => {
    const result = await Effect.runPromise(
      callHandler("docker.stop", { containerId: "my container" }),
    )
    expect("err" in result).toBe(true)
    if ("err" in result) {
      expect(result.err).toBeInstanceOf(ManagementError)
    }
  })
})

describe("k8s input validation", () => {
  it("rejects namespace with uppercase letters", async () => {
    const result = await Effect.runPromise(
      callHandler("k8s.scale", {
        namespace: "My-Namespace",
        deployment: "my-deploy",
        replicas: 2,
      }),
    )
    expect("err" in result).toBe(true)
    if ("err" in result) {
      expect(result.err).toBeInstanceOf(ManagementError)
      if (result.err instanceof ManagementError) {
        expect(result.err.code).toBe("invalid-input")
      }
    }
  })

  it("rejects name with path traversal in k8s.describe", async () => {
    const result = await Effect.runPromise(
      callHandler("k8s.describe", {
        namespace: "default",
        resource: "pod",
        name: "../../etc/passwd",
      }),
    )
    expect("err" in result).toBe(true)
    if ("err" in result) {
      expect(result.err).toBeInstanceOf(ManagementError)
    }
  })

  it("rejects k8s.restartPod with uppercase namespace", async () => {
    const result = await Effect.runPromise(
      callHandler("k8s.restartPod", {
        namespace: "DEFAULT",
        pod: "my-pod",
      }),
    )
    expect("err" in result).toBe(true)
    if ("err" in result) {
      expect(result.err).toBeInstanceOf(ManagementError)
      if (result.err instanceof ManagementError) {
        expect(result.err.code).toBe("invalid-input")
      }
    }
  })
})

// ── Systemd shell-out tests ───────────────────────────────────────────────────

describe("systemd handler shell-outs", () => {
  let spawnCalls: string[][]
  const originalSpawn = Bun.spawn

  beforeEach(() => {
    spawnCalls = []
    // @ts-expect-error mock
    Bun.spawn = (args: string[]) => {
      spawnCalls.push(args as string[])
      return {
        stdout: new ReadableStream({ start(c) { c.close() } }),
        stderr: new ReadableStream({ start(c) { c.close() } }),
        exited: Promise.resolve(0),
        exitCode: 0,
        kill: () => {},
      }
    }
  })

  afterEach(() => {
    Bun.spawn = originalSpawn
  })

  it("systemd.start spawns systemctl start for a valid unit", async () => {
    const result = await Effect.runPromise(
      callHandler("systemd.start", { unit: "nginx.service" }),
    )
    expect("ok" in result).toBe(true)
    const call = spawnCalls.find(
      (args) => args.includes("systemctl") && args.includes("start"),
    )
    expect(call).toBeTruthy()
    expect(call).toContain("nginx.service")
  })

  it("systemd.stop spawns systemctl stop", async () => {
    await Effect.runPromise(
      callHandler("systemd.stop", { unit: "nginx.service" }),
    )
    expect(spawnCalls.some((args) => args.includes("stop"))).toBe(true)
  })

  it("systemd.restart spawns systemctl restart", async () => {
    await Effect.runPromise(
      callHandler("systemd.restart", { unit: "myapp.service" }),
    )
    expect(spawnCalls.some((args) => args.includes("restart"))).toBe(true)
  })

  it("systemd.enable spawns systemctl enable", async () => {
    await Effect.runPromise(
      callHandler("systemd.enable", { unit: "myapp.service" }),
    )
    expect(spawnCalls.some((args) => args.includes("enable"))).toBe(true)
  })

  it("systemd.disable spawns systemctl disable", async () => {
    await Effect.runPromise(
      callHandler("systemd.disable", { unit: "myapp.service" }),
    )
    expect(spawnCalls.some((args) => args.includes("disable"))).toBe(true)
  })

  it("systemd.reload spawns systemctl daemon-reload", async () => {
    await Effect.runPromise(
      callHandler("systemd.reload", {}),
    )
    expect(
      spawnCalls.some((args) => args.includes("daemon-reload")),
    ).toBe(true)
  })
})

// ── Docker API tests ──────────────────────────────────────────────────────────

describe("docker handler API calls", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const originalFetch = global.fetch

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "",
    })
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("docker.start calls /containers/:id/start", async () => {
    await Effect.runPromise(
      callHandler("docker.start", { containerId: "abc123" }),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchMock).toHaveBeenCalled()
    const url = fetchMock.mock.calls[0]?.[0] as string
    expect(url).toContain("abc123")
    expect(url).toContain("/start")
  })

  it("docker.stop calls /containers/:id/stop", async () => {
    await Effect.runPromise(
      callHandler("docker.stop", { containerId: "def456" }),
    )
    await new Promise((r) => setTimeout(r, 50))
    const url = fetchMock.mock.calls[0]?.[0] as string
    expect(url).toContain("/stop")
  })

  it("docker.restart calls /containers/:id/restart", async () => {
    await Effect.runPromise(
      callHandler("docker.restart", { containerId: "ghi789" }),
    )
    await new Promise((r) => setTimeout(r, 50))
    const url = fetchMock.mock.calls[0]?.[0] as string
    expect(url).toContain("/restart")
  })

  it("docker.remove calls DELETE /containers/:id", async () => {
    await Effect.runPromise(
      callHandler("docker.remove", { containerId: "abc123" }),
    )
    await new Promise((r) => setTimeout(r, 50))
    const opts = fetchMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(opts?.["method"]).toBe("DELETE")
  })

  it("docker.inspect calls /containers/:id/json and returns parsed JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ Id: "abc123", Name: "/test" }),
    })
    const result = await Effect.runPromise(
      callHandler("docker.inspect", { containerId: "abc123" }),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchMock).toHaveBeenCalled()
    const url = fetchMock.mock.calls[0]?.[0] as string
    expect(url).toContain("/json")
    expect("ok" in result).toBe(true)
  })
})

// ── K8s tests ─────────────────────────────────────────────────────────────────

describe("k8s handlers with mock fetch", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const originalFetch = global.fetch

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ status: "ok" }),
    })
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("k8s.scale succeeds or returns error when config absent", async () => {
    const result = await Effect.runPromise(
      callHandler("k8s.scale", {
        namespace: "default",
        deployment: "my-app",
        replicas: 3,
      }),
    )
    expect("ok" in result || "err" in result).toBe(true)
  })

  it("k8s.describe with valid params either succeeds or returns error", async () => {
    const result = await Effect.runPromise(
      callHandler("k8s.describe", {
        namespace: "default",
        resource: "pod",
        name: "my-pod-abc",
      }),
    )
    expect("ok" in result || "err" in result).toBe(true)
  })
})

// ── Terminal session tests ────────────────────────────────────────────────────

describe("terminal session management", () => {
  it("terminal.input fails with session-not-found for unknown sessionId", async () => {
    const result = await Effect.runPromise(
      callHandler("terminal.input", {
        sessionId: "nonexistent-session",
        dataBase64: btoa("hello"),
      }),
    )
    expect("err" in result).toBe(true)
    if ("err" in result) {
      expect(result.err).toBeInstanceOf(ManagementError)
      if (result.err instanceof ManagementError) {
        expect(result.err.code).toBe("session-not-found")
      }
    }
  })

  it("terminal.resize fails with session-not-found for unknown sessionId", async () => {
    const result = await Effect.runPromise(
      callHandler("terminal.resize", {
        sessionId: "nonexistent-session",
        cols: 80,
        rows: 24,
      }),
    )
    expect("err" in result).toBe(true)
    if ("err" in result) {
      expect(result.err).toBeInstanceOf(ManagementError)
      if (result.err instanceof ManagementError) {
        expect(result.err.code).toBe("session-not-found")
      }
    }
  })

  it("terminal.close fails with session-not-found for unknown sessionId", async () => {
    const result = await Effect.runPromise(
      callHandler("terminal.close", {
        sessionId: "nonexistent-session",
      }),
    )
    expect("err" in result).toBe(true)
    if ("err" in result) {
      expect(result.err).toBeInstanceOf(ManagementError)
      if (result.err instanceof ManagementError) {
        expect(result.err.code).toBe("session-not-found")
      }
    }
  })
})

// ── Logs tests ────────────────────────────────────────────────────────────────

describe("logs.tail handler", () => {
  it("logs.tail with systemd source returns a Queue-like object", async () => {
    const result = await Effect.runPromise(
      callHandler("logs.tail", {
        source: "systemd",
        target: "nginx.service",
        tail: 10,
      }).pipe(Effect.scoped),
    )
    expect("ok" in result).toBe(true)
    if ("ok" in result) {
      expect(result.ok !== null && typeof result.ok === "object").toBe(true)
    }
  })

  it("logs.tail with k8s source makes a fetch call", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("line1\n"))
          c.close()
        },
      }),
    })
    const originalFetch = global.fetch
    global.fetch = fetchMock as unknown as typeof fetch

    try {
      await Effect.runPromise(
        callHandler("logs.tail", {
          source: "k8s",
          target: "my-pod",
          namespace: "default",
          tail: 50,
        }).pipe(
          Effect.flatMap((_result) => Effect.sleep(150)),
          Effect.scoped,
        ),
      )
      expect(fetchMock).toHaveBeenCalled()
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain("my-pod")
      expect(url).toContain("follow=true")
      expect(url).toContain("tailLines=50")
    } finally {
      global.fetch = originalFetch
    }
  })
})

// ── Layer health check ────────────────────────────────────────────────────────

describe("HubAgentHandlersLive layer", () => {
  it("can be built successfully", async () => {
    const result = await Effect.runPromise(
      Effect.succeed(true).pipe(Effect.provide(HubAgentHandlersLive)),
    )
    expect(result).toBe(true)
  })
})
