import { Effect, Layer, Ref, Stream } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import fs from "node:fs"
import os from "node:os"
import { isRpcRequest } from "@scout/shared"
import type { ScoutMessage } from "@scout/shared"
import { HubConnection } from "./hub-connection.js"

// ── Active stream tracking ────────────────────────────────────────────────────

interface ActiveStream {
  readonly abort: () => void
}

// ── Log streaming helpers ─────────────────────────────────────────────────────

interface LogStartParams {
  streamId: string
  source: "k8s" | "systemd"
  target: string
  namespace?: string
  container?: string
  tail: number
}

// Batch lines and send as a logs.data event
function sendLogLines(
  hub: { send: (msg: ScoutMessage) => Effect.Effect<void> },
  streamId: string,
  lines: string[],
): Effect.Effect<void> {
  if (lines.length === 0) return Effect.void
  return hub.send({
    event: "logs.data",
    streamId,
    data: { lines },
  })
}

// Resolve K8s config synchronously
function resolveK8sAuth(): { baseUrl: string; authHeader: string } {
  let baseUrl = "https://kubernetes.default.svc"
  let authHeader = ""

  const tokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token"
  try {
    if (fs.existsSync(tokenPath)) {
      const token = fs.readFileSync(tokenPath, "utf8").trim()
      const host = process.env["KUBERNETES_SERVICE_HOST"] ?? "kubernetes.default.svc"
      const port = process.env["KUBERNETES_SERVICE_PORT"] ?? "443"
      baseUrl = `https://${host}:${port}`
      authHeader = `Bearer ${token}`
    } else {
      const kubeconfigPath =
        process.env["KUBECONFIG"] ?? `${os.homedir()}/.kube/config`
      if (fs.existsSync(kubeconfigPath)) {
        const raw = fs.readFileSync(kubeconfigPath, "utf8")
        const serverMatch = raw.match(/\bserver:\s*(\S+)/)
        const tokenMatch = raw.match(/\btoken:\s*(\S+)/)
        if (serverMatch?.[1]) {
          baseUrl = serverMatch[1]
        }
        if (tokenMatch?.[1]) {
          authHeader = `Bearer ${tokenMatch[1]}`
        }
      }
    }
  } catch {
    // best effort
  }

  return { baseUrl, authHeader }
}

// Stream K8s pod logs
function startK8sStream(
  params: LogStartParams,
  hub: { send: (msg: ScoutMessage) => Effect.Effect<void> },
): Effect.Effect<ActiveStream> {
  return Effect.gen(function* () {
    const controller = new AbortController()
    const { baseUrl, authHeader } = resolveK8sAuth()

    const namespace = params.namespace ?? "default"
    const containerQuery = params.container ? `&container=${encodeURIComponent(params.container)}` : ""
    const url = `${baseUrl}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(params.target)}/log?follow=true&tailLines=${params.tail}${containerQuery}`

    const headers: Record<string, string> = {}
    if (authHeader) headers["Authorization"] = authHeader

    // Fire-and-forget stream loop
    void Effect.runPromise(
      Effect.tryPromise({
        try: async () => {
          const res = await fetch(url, {
            headers,
            signal: controller.signal,
          })

          if (!res.body) return

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ""

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })

            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""

            const toSend = lines.filter((l) => l.length > 0)
            if (toSend.length > 0) {
              await Effect.runPromise(sendLogLines(hub, params.streamId, toSend))
            }
          }

          // Send any remaining buffered content
          if (buffer.length > 0) {
            await Effect.runPromise(sendLogLines(hub, params.streamId, [buffer]))
          }
        },
        catch: () => undefined,
      }).pipe(Effect.ignore)
    )

    return { abort: () => controller.abort() }
  })
}

// Stream systemd journal
function startSystemdStream(
  params: LogStartParams,
  hub: { send: (msg: ScoutMessage) => Effect.Effect<void> },
): Effect.Effect<ActiveStream> {
  return Effect.sync(() => {
    let proc: ReturnType<typeof Bun.spawn> | null = null
    try {
      proc = Bun.spawn(
        ["journalctl", "-f", "-u", params.target, "-n", String(params.tail), "--output=short-iso"],
        { stdout: "pipe", stderr: "pipe" },
      )
    } catch {
      // journalctl not available — return a no-op stream
      return { abort: () => {} }
    }

    let batchTimer: ReturnType<typeof setTimeout> | null = null
    let lineBatch: string[] = []

    const flush = () => {
      if (lineBatch.length === 0) return
      const toSend = lineBatch.splice(0)
      void Effect.runPromise(sendLogLines(hub, params.streamId, toSend))
    }

    // Read stdout line by line
    void (async () => {
      try {
        const reader = (proc!.stdout as ReadableStream<Uint8Array>).getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            if (line.length === 0) continue
            lineBatch.push(line)

            if (lineBatch.length >= 50) {
              if (batchTimer) {
                clearTimeout(batchTimer)
                batchTimer = null
              }
              flush()
            } else if (!batchTimer) {
              batchTimer = setTimeout(() => {
                batchTimer = null
                flush()
              }, 100)
            }
          }
        }

        // Flush remaining
        if (batchTimer) clearTimeout(batchTimer)
        flush()
      } catch {
        // process killed or error
      }
    })()

    return {
      abort: () => {
        if (batchTimer) clearTimeout(batchTimer)
        proc!.kill()
      },
    }
  })
}

// ── Service ───────────────────────────────────────────────────────────────────

export class CommandHandler extends ServiceMap.Service<CommandHandler, {
  /**
   * Long-running fiber: listens for inbound RPC requests from the hub and
   * dispatches them to the appropriate handler. Never resolves under normal operation.
   */
  readonly run: Effect.Effect<never>
}>()(
  "@scout/CommandHandler",
  {
    make: Effect.gen(function* () {
      const hub = yield* HubConnection
      // Active log streams: streamId → AbortController/kill fn
      const activeStreams = yield* Ref.make(new Map<string, ActiveStream>())

      const runForever: Effect.Effect<void> = Stream.runForEach(
        hub.onMessage,
        (msg) =>
          Effect.gen(function* () {
            if (!isRpcRequest(msg)) return

            const { method, params = {} } = msg

            if (method === "logs.start") {
              const streamId = params["streamId"] as string | undefined
              const source = params["source"] as "k8s" | "systemd" | undefined
              const target = params["target"] as string | undefined
              const tail = typeof params["tail"] === "number" ? params["tail"] : 100

              if (!streamId || !source || !target) {
                yield* Effect.logWarning("CommandHandler: logs.start missing params")
                return
              }

              const logParams: LogStartParams = {
                streamId,
                source,
                target,
                namespace: params["namespace"] as string | undefined,
                container: params["container"] as string | undefined,
                tail,
              }

              yield* Effect.log(`CommandHandler: starting log stream ${streamId} (${source}:${target})`)

              const stream = source === "k8s"
                ? yield* startK8sStream(logParams, hub)
                : yield* startSystemdStream(logParams, hub)

              yield* Ref.update(activeStreams, (m) => new Map(m).set(streamId, stream))
            } else if (method === "logs.stop") {
              const streamId = params["streamId"] as string | undefined
              if (!streamId) return

              const streams = yield* Ref.get(activeStreams)
              const active = streams.get(streamId)
              if (active) {
                active.abort()
                yield* Ref.update(activeStreams, (m) => {
                  const next = new Map(m)
                  next.delete(streamId)
                  return next
                })
                yield* Effect.log(`CommandHandler: stopped log stream ${streamId}`)
              }
            } else {
              yield* Effect.log(`CommandHandler: unknown method ${method}`)
            }
          })
      )

      // Never resolves — follows the stream forever, then restarts
      const run: Effect.Effect<never> = runForever.pipe(
        Effect.flatMap(() => Effect.never)
      )

      return { run }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
