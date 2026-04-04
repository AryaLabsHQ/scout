import { Effect, Layer, Ref, Stream } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { isRpcRequest } from "@scout/shared"
import type { ScoutMessage } from "@scout/shared"
import { HubConnection } from "./hub-connection.js"

// ── Input validation ─────────────────────────────────────────────────────────

/**
 * Validates a systemd unit name: no path separators or traversal, non-empty,
 * must contain a dot (e.g. "nginx.service").
 */
function validateUnit(unit: string): boolean {
  if (!unit || unit.length === 0 || unit.length > 256) return false
  if (unit.includes("/") || unit.includes("\\") || unit.includes("..")) return false
  // Must look like a unit name (letters, digits, dash, underscore, dot, @, colon)
  return /^[a-zA-Z0-9_\-@:.\\]+$/.test(unit)
}

/**
 * Validates a Docker container ID/name: alphanumeric, dash, underscore.
 */
function validateContainerId(id: string): boolean {
  if (!id || id.length === 0 || id.length > 128) return false
  return /^[a-zA-Z0-9_\-]+$/.test(id)
}

/**
 * Validates a Kubernetes DNS label: lowercase alphanumeric, dash, dot.
 */
function validateK8sName(name: string): boolean {
  if (!name || name.length === 0 || name.length > 253) return false
  return /^[a-z0-9][a-z0-9\-\.]*[a-z0-9]$|^[a-z0-9]$/.test(name)
}

// ── RPC response helper ───────────────────────────────────────────────────────

function replyOk(
  hub: { send: (msg: ScoutMessage) => Effect.Effect<void> },
  id: string,
  result: unknown = null,
): Effect.Effect<void> {
  return hub.send({ id, ok: true, result } as ScoutMessage)
}

function replyError(
  hub: { send: (msg: ScoutMessage) => Effect.Effect<void> },
  id: string,
  code: string,
  message: string,
): Effect.Effect<void> {
  return hub.send({ id, ok: false, error: { code, message } } as ScoutMessage)
}

// ── Systemd management ────────────────────────────────────────────────────────

function runSystemctl(args: string[]): Effect.Effect<string> {
  return Effect.tryPromise(async () => {
    const proc = Bun.spawn(["sudo", "systemctl", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, _stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (exitCode !== 0) {
      throw new Error(`systemctl ${args[0]} exited with ${exitCode}`)
    }
    return stdout
  }).pipe(Effect.orDie)
}

// ── Docker management ─────────────────────────────────────────────────────────

function dockerPost(path: string, body?: unknown): Effect.Effect<string> {
  return Effect.tryPromise(async () => {
    const opts: Record<string, unknown> = {
      method: "POST",
      unix: "/var/run/docker.sock",
    }
    if (body !== undefined) {
      opts["headers"] = { "Content-Type": "application/json" }
      opts["body"] = JSON.stringify(body)
    }
    const res = await fetch(`http://localhost${path}`, opts as RequestInit)
    return res.text()
  }).pipe(Effect.orDie)
}

function dockerDelete(path: string): Effect.Effect<string> {
  return Effect.tryPromise(async () => {
    const res = await fetch(`http://localhost${path}`, {
      method: "DELETE",
      unix: "/var/run/docker.sock",
    } as unknown as RequestInit)
    return res.text()
  }).pipe(Effect.orDie)
}

function dockerGet(path: string): Effect.Effect<string> {
  return Effect.tryPromise(async () => {
    const res = await fetch(`http://localhost${path}`, {
      unix: "/var/run/docker.sock",
    } as unknown as RequestInit)
    return res.text()
  }).pipe(Effect.orDie)
}

// ── K8s management ────────────────────────────────────────────────────────────

function getK8sConfig(): { baseUrl: string; headers: Record<string, string> } | null {
  const tokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token"
  if (fs.existsSync(tokenPath)) {
    try {
      const token = fs.readFileSync(tokenPath, "utf8").trim()
      const host = process.env["KUBERNETES_SERVICE_HOST"] ?? "kubernetes.default.svc"
      const port = process.env["KUBERNETES_SERVICE_PORT"] ?? "443"
      return {
        baseUrl: `https://${host}:${port}`,
        headers: { Authorization: `Bearer ${token}` },
      }
    } catch { /* fall through */ }
  }
  const kubeconfigPath = process.env["KUBECONFIG"] ?? `${os.homedir()}/.kube/config`
  if (fs.existsSync(kubeconfigPath)) {
    try {
      const raw = fs.readFileSync(kubeconfigPath, "utf8")
      const serverMatch = raw.match(/\bserver:\s*(\S+)/)
      const tokenMatch = raw.match(/\btoken:\s*(\S+)/)
      if (serverMatch?.[1]) {
        const cfg: { baseUrl: string; headers: Record<string, string> } = {
          baseUrl: serverMatch[1],
          headers: {},
        }
        if (tokenMatch?.[1]) cfg.headers["Authorization"] = `Bearer ${tokenMatch[1]}`
        return cfg
      }
    } catch { /* fall through */ }
  }
  return null
}

function k8sFetch(
  cfg: { baseUrl: string; headers: Record<string, string> },
  apiPath: string,
  method = "GET",
  body?: unknown,
): Effect.Effect<string> {
  return Effect.tryPromise(async () => {
    const opts: RequestInit = { method, headers: { ...cfg.headers } }
    if (body !== undefined) {
      ;(opts.headers as Record<string, string>)["Content-Type"] = "application/merge-patch+json"
      opts.body = JSON.stringify(body)
    }
    const res = await fetch(`${cfg.baseUrl}${apiPath}`, opts)
    return res.text()
  }).pipe(Effect.orDie)
}

// ── Active stream tracking ────────────────────────────────────────────────────

interface ActiveStream {
  readonly abort: () => void
}

// ── Active terminal sessions ──────────────────────────────────────────────────

interface ActiveTerminal {
  readonly proc: ReturnType<typeof Bun.spawn>
  readonly mode: "shell" | "podExec"
  readonly abort: () => void
}

// ── Terminal helpers ──────────────────────────────────────────────────────────

function startTerminalProcess(params: {
  sessionId: string
  mode: "shell" | "podExec"
  cols: number
  rows: number
  podName?: string
  namespace?: string
  hub: { send: (msg: ScoutMessage) => Effect.Effect<void> }
}): Effect.Effect<ActiveTerminal> {
  return Effect.sync(() => {
    const { sessionId, mode, cols, rows, podName, namespace, hub } = params
    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][]
      ),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      COLUMNS: String(cols),
      LINES: String(rows),
    }

    let proc: ReturnType<typeof Bun.spawn>

    if (mode === "podExec") {
      if (!podName) {
        throw new Error("podName required for podExec mode")
      }
      const ns = namespace ?? "default"
      const kubeconfigPath = process.env["KUBECONFIG"] ?? `${os.homedir()}/.kube/config`
      if (kubeconfigPath) env["KUBECONFIG"] = kubeconfigPath
      // Use script wrapper for PTY allocation on Linux/macOS
      const shell = "/bin/sh"
      const execArgs = ["kubectl", "exec", "-it", podName, "-n", ns, "--", shell]
      proc = Bun.spawn(execArgs, {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env,
      })
    } else {
      // shell mode — use `script` to allocate a PTY on Linux, direct spawn on macOS
      const shell = process.env["SHELL"] ?? "/bin/bash"
      const platform = process.platform
      if (platform === "linux") {
        proc = Bun.spawn(["script", "-qc", shell, "/dev/null"], {
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
          env,
        })
      } else {
        // macOS: script syntax differs — fallback to direct spawn
        proc = Bun.spawn([shell], {
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
          env,
        })
      }
    }

    const aborted = { current: false }

    // Stream stdout to hub as terminal.output events
    void (async () => {
      try {
        const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
        while (!aborted.current) {
          const { done, value } = await reader.read()
          if (done) break
          if (value && value.length > 0) {
            // base64 encode the chunk
            const b64 = Buffer.from(value).toString("base64")
            await Effect.runPromise(
              hub.send({
                event: "terminal.output",
                streamId: sessionId,
                dataBase64: b64,
              } as ScoutMessage)
            )
          }
        }
      } catch {
        // process killed or error
      }
    })()

    // Also stream stderr
    void (async () => {
      try {
        const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader()
        while (!aborted.current) {
          const { done, value } = await reader.read()
          if (done) break
          if (value && value.length > 0) {
            const b64 = Buffer.from(value).toString("base64")
            await Effect.runPromise(
              hub.send({
                event: "terminal.output",
                streamId: sessionId,
                dataBase64: b64,
              } as ScoutMessage)
            )
          }
        }
      } catch {
        // process killed or error
      }
    })()

    return {
      proc,
      mode,
      abort: () => {
        aborted.current = true
        try { proc.kill() } catch { /* ignore */ }
      },
    }
  })
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
      // Active terminal sessions: sessionId → ActiveTerminal
      const activeTerminals = yield* Ref.make(new Map<string, ActiveTerminal>())

      const runForever: Effect.Effect<void> = Stream.runForEach(
        hub.onMessage,
        (msg) =>
          Effect.gen(function* () {
            if (!isRpcRequest(msg)) return

            const { id, method, params = {} } = msg

            // ── Log streaming ────────────────────────────────────────────────

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

            // ── Systemd management ───────────────────────────────────────────

            } else if (
              method === "systemd.start" || method === "systemd.stop" ||
              method === "systemd.restart" || method === "systemd.enable" ||
              method === "systemd.disable"
            ) {
              const unit = params["unit"] as string | undefined
              if (!unit || !validateUnit(unit)) {
                yield* replyError(hub, id, "INVALID_UNIT", "Invalid or missing unit name")
                return
              }
              const action = method.replace("systemd.", "")
              const result = yield* Effect.exit(runSystemctl([action, unit]))
              if (result._tag === "Failure") {
                yield* replyError(hub, id, "SYSTEMCTL_ERROR", `systemctl ${action} failed`)
              } else {
                yield* replyOk(hub, id, null)
              }

            } else if (method === "systemd.reload") {
              const result = yield* Effect.exit(runSystemctl(["daemon-reload"]))
              if (result._tag === "Failure") {
                yield* replyError(hub, id, "SYSTEMCTL_ERROR", "systemctl daemon-reload failed")
              } else {
                yield* replyOk(hub, id, null)
              }

            } else if (method === "systemd.unit-file") {
              const unit = params["unit"] as string | undefined
              if (!unit || !validateUnit(unit)) {
                yield* replyError(hub, id, "INVALID_UNIT", "Invalid or missing unit name")
                return
              }
              const showResult = yield* Effect.exit(runSystemctl(["show", "-p", "FragmentPath", unit]))
              if (showResult._tag === "Failure") {
                yield* replyError(hub, id, "SYSTEMCTL_ERROR", "Could not get unit file path")
                return
              }
              const match = showResult.value.match(/^FragmentPath=(.+)$/m)
              const filePath = match?.[1]?.trim() ?? ""
              if (!filePath) {
                yield* replyError(hub, id, "NOT_FOUND", "Unit file path not found")
                return
              }
              try {
                const content = fs.readFileSync(filePath, "utf8")
                yield* replyOk(hub, id, { path: filePath, content })
              } catch {
                yield* replyError(hub, id, "READ_ERROR", "Could not read unit file")
              }

            } else if (method === "systemd.unit-file-edit") {
              const unit = params["unit"] as string | undefined
              const content = params["content"] as string | undefined
              if (!unit || !validateUnit(unit)) {
                yield* replyError(hub, id, "INVALID_UNIT", "Invalid or missing unit name")
                return
              }
              if (typeof content !== "string") {
                yield* replyError(hub, id, "BAD_REQUEST", "Missing content")
                return
              }
              // Get target path
              const showResult = yield* Effect.exit(runSystemctl(["show", "-p", "FragmentPath", unit]))
              if (showResult._tag === "Failure") {
                yield* replyError(hub, id, "SYSTEMCTL_ERROR", "Could not get unit file path")
                return
              }
              const match = showResult.value.match(/^FragmentPath=(.+)$/m)
              const targetPath = match?.[1]?.trim() ?? ""
              if (!targetPath) {
                yield* replyError(hub, id, "NOT_FOUND", "Unit file path not found")
                return
              }
              // Write to temp file, verify, then move
              const tmpPath = path.join(os.tmpdir(), `scout-unit-${crypto.randomUUID()}.tmp`)
              try {
                fs.writeFileSync(tmpPath, content, "utf8")
                const verifyResult = yield* Effect.exit(
                  Effect.tryPromise({
                    try: async () => {
                      const proc = Bun.spawn(["systemd-analyze", "verify", tmpPath], {
                        stdout: "pipe",
                        stderr: "pipe",
                      })
                      await proc.exited
                      return proc.exitCode ?? 1
                    },
                    catch: () => 1 as unknown,
                  })
                )
                if (verifyResult._tag === "Success" && verifyResult.value === 0) {
                  fs.copyFileSync(tmpPath, targetPath)
                  yield* runSystemctl(["daemon-reload"]).pipe(Effect.ignore)
                  yield* replyOk(hub, id, null)
                } else {
                  yield* replyError(hub, id, "VERIFY_FAILED", "systemd-analyze verify failed")
                }
              } catch {
                yield* replyError(hub, id, "WRITE_ERROR", "Could not write unit file")
              } finally {
                try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
              }

            // ── Docker management ────────────────────────────────────────────

            } else if (
              method === "docker.start" || method === "docker.stop" ||
              method === "docker.restart" || method === "docker.remove"
            ) {
              const containerId = params["containerId"] as string | undefined
              if (!containerId || !validateContainerId(containerId)) {
                yield* replyError(hub, id, "INVALID_CONTAINER_ID", "Invalid or missing containerId")
                return
              }
              let effect: Effect.Effect<string>
              if (method === "docker.remove") {
                effect = dockerDelete(`/containers/${containerId}`)
              } else {
                const action = method.replace("docker.", "")
                effect = dockerPost(`/containers/${containerId}/${action}`)
              }
              const result = yield* Effect.exit(effect)
              if (result._tag === "Failure") {
                yield* replyError(hub, id, "DOCKER_ERROR", `${method} failed`)
              } else {
                yield* replyOk(hub, id, null)
              }

            } else if (method === "docker.inspect") {
              const containerId = params["containerId"] as string | undefined
              if (!containerId || !validateContainerId(containerId)) {
                yield* replyError(hub, id, "INVALID_CONTAINER_ID", "Invalid or missing containerId")
                return
              }
              const result = yield* Effect.exit(dockerGet(`/containers/${containerId}/json`))
              if (result._tag === "Failure") {
                yield* replyError(hub, id, "DOCKER_ERROR", "docker inspect failed")
              } else {
                try {
                  const parsed = JSON.parse(result.value) as unknown
                  yield* replyOk(hub, id, parsed)
                } catch {
                  yield* replyOk(hub, id, result.value)
                }
              }

            } else if (method === "docker.logs") {
              const containerId = params["containerId"] as string | undefined
              const tail = typeof params["tail"] === "number" ? params["tail"] : 100
              if (!containerId || !validateContainerId(containerId)) {
                yield* replyError(hub, id, "INVALID_CONTAINER_ID", "Invalid or missing containerId")
                return
              }
              const result = yield* Effect.exit(
                dockerGet(`/containers/${containerId}/logs?tail=${tail}&stdout=true&stderr=true`)
              )
              if (result._tag === "Failure") {
                yield* replyError(hub, id, "DOCKER_ERROR", "docker logs failed")
              } else {
                yield* replyOk(hub, id, result.value)
              }

            // ── K8s management ───────────────────────────────────────────────

            } else if (method === "k8s.scale") {
              const deployment = params["deployment"] as string | undefined
              const namespace = (params["namespace"] as string | undefined) ?? "default"
              const replicas = params["replicas"]
              if (!deployment || !validateK8sName(deployment) || !validateK8sName(namespace) || typeof replicas !== "number") {
                yield* replyError(hub, id, "INVALID_PARAMS", "Invalid deployment, namespace, or replicas")
                return
              }
              const cfg = getK8sConfig()
              if (!cfg) {
                yield* replyError(hub, id, "K8S_NOT_CONFIGURED", "No K8s config available")
                return
              }
              const result = yield* Effect.exit(
                k8sFetch(
                  cfg,
                  `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(deployment)}/scale`,
                  "PATCH",
                  { spec: { replicas } },
                )
              )
              if (result._tag === "Failure") {
                yield* replyError(hub, id, "K8S_ERROR", "k8s scale failed")
              } else {
                yield* replyOk(hub, id, null)
              }

            } else if (method === "k8s.restart-pod") {
              const podName = params["podName"] as string | undefined
              const namespace = (params["namespace"] as string | undefined) ?? "default"
              if (!podName || !validateK8sName(podName) || !validateK8sName(namespace)) {
                yield* replyError(hub, id, "INVALID_PARAMS", "Invalid podName or namespace")
                return
              }
              const cfg = getK8sConfig()
              if (!cfg) {
                yield* replyError(hub, id, "K8S_NOT_CONFIGURED", "No K8s config available")
                return
              }
              const result = yield* Effect.exit(
                k8sFetch(
                  cfg,
                  `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}`,
                  "DELETE",
                )
              )
              if (result._tag === "Failure") {
                yield* replyError(hub, id, "K8S_ERROR", "k8s restart-pod failed")
              } else {
                yield* replyOk(hub, id, null)
              }

            } else if (method === "k8s.describe") {
              const resource = params["resource"] as string | undefined
              const name = params["name"] as string | undefined
              const namespace = (params["namespace"] as string | undefined) ?? "default"
              if (!resource || !name || !validateK8sName(name) || !validateK8sName(namespace)) {
                yield* replyError(hub, id, "INVALID_PARAMS", "Invalid resource, name, or namespace")
                return
              }
              const cfg = getK8sConfig()
              if (!cfg) {
                yield* replyError(hub, id, "K8S_NOT_CONFIGURED", "No K8s config available")
                return
              }
              const apiPath = resource === "pod" || resource === "pods"
                ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}`
                : `/api/v1/namespaces/${encodeURIComponent(namespace)}/${encodeURIComponent(resource)}s/${encodeURIComponent(name)}`
              const result = yield* Effect.exit(k8sFetch(cfg, apiPath))
              if (result._tag === "Failure") {
                yield* replyError(hub, id, "K8S_ERROR", "k8s describe failed")
              } else {
                yield* replyOk(hub, id, result.value)
              }

            // ── Terminal management ──────────────────────────────────────────

            } else if (method === "terminal.open") {
              const sessionId = params["sessionId"] as string | undefined
              const mode = params["mode"] as "shell" | "podExec" | undefined
              const cols = typeof params["cols"] === "number" ? params["cols"] : 80
              const rows = typeof params["rows"] === "number" ? params["rows"] : 24

              if (!sessionId || !mode) {
                yield* Effect.logWarning("CommandHandler: terminal.open missing params")
                return
              }

              yield* Effect.log(`CommandHandler: opening terminal session ${sessionId} (${mode})`)

              const termResult = yield* Effect.exit(
                startTerminalProcess({
                  sessionId,
                  mode,
                  cols,
                  rows,
                  podName: params["podName"] as string | undefined,
                  namespace: params["namespace"] as string | undefined,
                  hub,
                })
              )

              if (termResult._tag === "Failure") {
                yield* Effect.logWarning(`CommandHandler: terminal.open failed for ${sessionId}`)
                return
              }

              yield* Ref.update(activeTerminals, (m) => new Map(m).set(sessionId, termResult.value))

            } else if (method === "terminal.input") {
              const sessionId = params["sessionId"] as string | undefined
              const dataBase64 = params["dataBase64"] as string | undefined

              if (!sessionId || !dataBase64) return

              const terminals = yield* Ref.get(activeTerminals)
              const term = terminals.get(sessionId)
              if (term && term.proc.stdin) {
                yield* Effect.tryPromise(async () => {
                  const data = Buffer.from(dataBase64, "base64")
                  const stdin = term.proc.stdin as { write(data: Uint8Array): number }
                  stdin.write(data)
                }).pipe(Effect.ignore)
              }

            } else if (method === "terminal.resize") {
              const sessionId = params["sessionId"] as string | undefined
              // Resize is best-effort with non-PTY processes
              // Log it for now; a real PTY implementation would send SIGWINCH
              if (sessionId) {
                yield* Effect.log(`CommandHandler: resize session ${sessionId} to ${params["cols"]}x${params["rows"]}`)
              }

            } else if (method === "terminal.close") {
              const sessionId = params["sessionId"] as string | undefined
              if (!sessionId) return

              const terminals = yield* Ref.get(activeTerminals)
              const term = terminals.get(sessionId)
              if (term) {
                term.abort()
                yield* Ref.update(activeTerminals, (m) => {
                  const next = new Map(m)
                  next.delete(sessionId)
                  return next
                })
                yield* Effect.log(`CommandHandler: closed terminal session ${sessionId}`)
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
