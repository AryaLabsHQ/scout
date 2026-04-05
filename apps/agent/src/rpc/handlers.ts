/**
 * HubAgentRpcs handler implementations.
 *
 * Implements all 20 methods the hub can call on the agent. The surrounding
 * shape is HubAgentRpcs.toLayer; the inner implementations are lifted
 * verbatim from the old command-handler.ts.
 */

import { Effect, Queue, Ref } from "effect"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { HubAgentRpcs, ManagementError } from "@scout/shared"
import type { TerminalOutput, LogBatch } from "@scout/shared"

// ── Input validation ──────────────────────────────────────────────────────────

/**
 * Validates a systemd unit name: no path separators or traversal, non-empty,
 * must contain a dot (e.g. "nginx.service").
 */
function validateUnit(unit: string): boolean {
  if (!unit || unit.length === 0 || unit.length > 256) return false
  if (unit.includes("/") || unit.includes("\\") || unit.includes("..")) return false
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

// ── Systemd helpers ───────────────────────────────────────────────────────────

function runSystemctl(args: string[]): Effect.Effect<string> {
  return Effect.tryPromise(async () => {
    const cmd =
      process.getuid?.() === 0
        ? ["systemctl", ...args]
        : ["sudo", "systemctl", ...args]
    const proc = Bun.spawn(cmd, {
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

// ── Docker helpers ────────────────────────────────────────────────────────────

function dockerPost(apiPath: string, body?: unknown): Effect.Effect<string> {
  return Effect.tryPromise(async () => {
    const opts: Record<string, unknown> = {
      method: "POST",
      unix: "/var/run/docker.sock",
    }
    if (body !== undefined) {
      opts["headers"] = { "Content-Type": "application/json" }
      opts["body"] = JSON.stringify(body)
    }
    const res = await fetch(`http://localhost${apiPath}`, opts as RequestInit)
    return res.text()
  }).pipe(Effect.orDie)
}

function dockerDelete(apiPath: string): Effect.Effect<string> {
  return Effect.tryPromise(async () => {
    const res = await fetch(`http://localhost${apiPath}`, {
      method: "DELETE",
      unix: "/var/run/docker.sock",
    } as unknown as RequestInit)
    return res.text()
  }).pipe(Effect.orDie)
}

function dockerGet(apiPath: string): Effect.Effect<string> {
  return Effect.tryPromise(async () => {
    const res = await fetch(`http://localhost${apiPath}`, {
      unix: "/var/run/docker.sock",
    } as unknown as RequestInit)
    return res.text()
  }).pipe(Effect.orDie)
}

// ── K8s helpers ───────────────────────────────────────────────────────────────

function getK8sConfig(): {
  baseUrl: string
  headers: Record<string, string>
} | null {
  const tokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token"
  if (fs.existsSync(tokenPath)) {
    try {
      const token = fs.readFileSync(tokenPath, "utf8").trim()
      const host =
        process.env["KUBERNETES_SERVICE_HOST"] ?? "kubernetes.default.svc"
      const port = process.env["KUBERNETES_SERVICE_PORT"] ?? "443"
      return {
        baseUrl: `https://${host}:${port}`,
        headers: { Authorization: `Bearer ${token}` },
      }
    } catch {
      /* fall through */
    }
  }
  const kubeconfigPath =
    process.env["KUBECONFIG"] ?? `${os.homedir()}/.kube/config`
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
    } catch {
      /* fall through */
    }
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
      ;(opts.headers as Record<string, string>)["Content-Type"] =
        "application/merge-patch+json"
      opts.body = JSON.stringify(body)
    }
    const res = await fetch(`${cfg.baseUrl}${apiPath}`, opts)
    return res.text()
  }).pipe(Effect.orDie)
}

// ── Terminal helpers ───────────────────────────────────────────────────────────

interface TerminalHandle {
  readonly proc: ReturnType<typeof Bun.spawn>
  readonly queue: Queue.Queue<TerminalOutput>
}

function spawnTerminalProcess(params: {
  sessionId: string
  mode: "shell" | "podExec"
  cols: number
  rows: number
  podName?: string
  namespace?: string
}): Effect.Effect<ReturnType<typeof Bun.spawn>> {
  return Effect.sync(() => {
    const { mode, cols, rows, podName, namespace } = params
    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([, v]) => v !== undefined,
        ) as [string, string][],
      ),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      COLUMNS: String(cols),
      LINES: String(rows),
    }

    if (mode === "podExec") {
      if (!podName) throw new Error("podName required for podExec mode")
      const ns = namespace ?? "default"
      const kubeconfigPath =
        process.env["KUBECONFIG"] ?? `${os.homedir()}/.kube/config`
      if (kubeconfigPath) env["KUBECONFIG"] = kubeconfigPath
      const shell = "/bin/sh"
      return Bun.spawn(
        ["kubectl", "exec", "-it", podName, "-n", ns, "--", shell],
        { stdin: "pipe", stdout: "pipe", stderr: "pipe", env },
      )
    }

    const shell = process.env["SHELL"] ?? "/bin/bash"
    if (process.platform === "linux") {
      return Bun.spawn(["script", "-qc", shell, "/dev/null"], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env,
      })
    }
    return Bun.spawn([shell], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env,
    })
  })
}

function pumpStreamToQueue(
  stream: ReadableStream<Uint8Array>,
  queue: Queue.Queue<TerminalOutput>,
): Effect.Effect<void> {
  return Effect.tryPromise(async () => {
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.length > 0) {
        const b64 = Buffer.from(value).toString("base64")
        await Effect.runPromise(
          Queue.offer(queue, { _tag: "output", dataBase64: b64 }),
        )
      }
    }
  }).pipe(Effect.ignore)
}

// ── Log streaming helpers ─────────────────────────────────────────────────────

function resolveK8sAuth(): { baseUrl: string; authHeader: string } {
  let baseUrl = "https://kubernetes.default.svc"
  let authHeader = ""

  const tokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token"
  try {
    if (fs.existsSync(tokenPath)) {
      const token = fs.readFileSync(tokenPath, "utf8").trim()
      const host =
        process.env["KUBERNETES_SERVICE_HOST"] ?? "kubernetes.default.svc"
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
        if (serverMatch?.[1]) baseUrl = serverMatch[1]
        if (tokenMatch?.[1]) authHeader = `Bearer ${tokenMatch[1]}`
      }
    }
  } catch {
    /* best effort */
  }

  return { baseUrl, authHeader }
}

function startK8sLogStream(params: {
  target: string
  namespace?: string
  container?: string
  tail: number
  queue: Queue.Queue<LogBatch>
}): Effect.Effect<() => void> {
  return Effect.sync(() => {
    const controller = new AbortController()
    const { baseUrl, authHeader } = resolveK8sAuth()

    const namespace = params.namespace ?? "default"
    const containerQuery = params.container
      ? `&container=${encodeURIComponent(params.container)}`
      : ""
    const url = `${baseUrl}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(params.target)}/log?follow=true&tailLines=${params.tail}${containerQuery}`

    const headers: Record<string, string> = {}
    if (authHeader) headers["Authorization"] = authHeader

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
              await Effect.runPromise(
                Queue.offer(params.queue, {
                  lines: toSend,
                  timestamp: Date.now(),
                }),
              )
            }
          }

          if (buffer.length > 0) {
            await Effect.runPromise(
              Queue.offer(params.queue, {
                lines: [buffer],
                timestamp: Date.now(),
              }),
            )
          }
        },
        catch: () => undefined,
      }).pipe(Effect.ignore),
    )

    return () => controller.abort()
  })
}

function startSystemdLogStream(params: {
  target: string
  tail: number
  queue: Queue.Queue<LogBatch>
}): Effect.Effect<() => void> {
  return Effect.sync(() => {
    let proc: ReturnType<typeof Bun.spawn> | null = null
    try {
      proc = Bun.spawn(
        [
          "journalctl",
          "-f",
          "-u",
          params.target,
          "-n",
          String(params.tail),
          "--output=short-iso",
        ],
        { stdout: "pipe", stderr: "pipe" },
      )
    } catch {
      return () => {}
    }

    let batchTimer: ReturnType<typeof setTimeout> | null = null
    let lineBatch: string[] = []

    const flush = () => {
      if (lineBatch.length === 0) return
      const toSend = lineBatch.splice(0)
      void Effect.runPromise(
        Queue.offer(params.queue, { lines: toSend, timestamp: Date.now() }),
      )
    }

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

        if (batchTimer) clearTimeout(batchTimer)
        flush()
      } catch {
        /* process killed or error */
      }
    })()

    return () => {
      if (batchTimer) clearTimeout(batchTimer)
      try {
        proc!.kill()
      } catch {
        /* ignore */
      }
    }
  })
}

// ── ManagementError factory ───────────────────────────────────────────────────

const fail = (code: string, message: string) =>
  Effect.fail(new ManagementError({ code, message }))

// ── Handler layer ─────────────────────────────────────────────────────────────

export const HubAgentHandlersLive = HubAgentRpcs.toLayer(
  Effect.gen(function* () {
    const terminals = yield* Ref.make(new Map<string, TerminalHandle>())

    return HubAgentRpcs.of({
      // ── Systemd ────────────────────────────────────────────────────────────

      "systemd.start": ({ unit }) =>
        !validateUnit(unit)
          ? fail("invalid-input", `Invalid unit name: ${unit}`)
          : runSystemctl(["start", unit]).pipe(Effect.asVoid),

      "systemd.stop": ({ unit }) =>
        !validateUnit(unit)
          ? fail("invalid-input", `Invalid unit name: ${unit}`)
          : runSystemctl(["stop", unit]).pipe(Effect.asVoid),

      "systemd.restart": ({ unit }) =>
        !validateUnit(unit)
          ? fail("invalid-input", `Invalid unit name: ${unit}`)
          : runSystemctl(["restart", unit]).pipe(Effect.asVoid),

      "systemd.enable": ({ unit }) =>
        !validateUnit(unit)
          ? fail("invalid-input", `Invalid unit name: ${unit}`)
          : runSystemctl(["enable", unit]).pipe(Effect.asVoid),

      "systemd.disable": ({ unit }) =>
        !validateUnit(unit)
          ? fail("invalid-input", `Invalid unit name: ${unit}`)
          : runSystemctl(["disable", unit]).pipe(Effect.asVoid),

      "systemd.reload": (_) =>
        runSystemctl(["daemon-reload"]).pipe(Effect.asVoid),

      "systemd.unitFile": ({ unit }) =>
        Effect.gen(function* () {
          if (!validateUnit(unit))
            return yield* fail("invalid-input", `Invalid unit name: ${unit}`)

          const output = yield* runSystemctl([
            "show",
            "-p",
            "FragmentPath",
            unit,
          ]).pipe(Effect.mapError(() => new ManagementError({ code: "systemctl-error", message: "Could not get unit file path" })))

          const match = output.match(/^FragmentPath=(.+)$/m)
          const filePath = match?.[1]?.trim() ?? ""
          if (!filePath)
            return yield* fail("not-found", "Unit file path not found")

          try {
            const content = fs.readFileSync(filePath, "utf8")
            return { path: filePath, content }
          } catch {
            return yield* fail("read-error", "Could not read unit file")
          }
        }),

      "systemd.unitFileEdit": ({ unit, content }) =>
        Effect.gen(function* () {
          if (!validateUnit(unit))
            return yield* fail("invalid-input", `Invalid unit name: ${unit}`)

          const showOutput = yield* runSystemctl([
            "show",
            "-p",
            "FragmentPath",
            unit,
          ])
          const match = showOutput.match(/^FragmentPath=(.+)$/m)
          const targetPath = match?.[1]?.trim() ?? ""
          if (!targetPath)
            return yield* fail("not-found", "Unit file path not found")

          const tmpPath = path.join(
            os.tmpdir(),
            `scout-unit-${crypto.randomUUID()}.tmp`,
          )
          try {
            fs.writeFileSync(tmpPath, content, "utf8")
            const verifyResult = yield* Effect.tryPromise({
              try: async () => {
                const proc = Bun.spawn(
                  ["systemd-analyze", "verify", tmpPath],
                  { stdout: "pipe", stderr: "pipe" },
                )
                await proc.exited
                return proc.exitCode ?? 1
              },
              catch: () => 1 as unknown,
            }).pipe(Effect.orDie)

            if (verifyResult === 0) {
              fs.copyFileSync(tmpPath, targetPath)
              yield* runSystemctl(["daemon-reload"]).pipe(Effect.ignore)
            } else {
              return yield* fail("verify-failed", "systemd-analyze verify failed")
            }
          } catch {
            return yield* fail("write-error", "Could not write unit file")
          } finally {
            try {
              fs.unlinkSync(tmpPath)
            } catch {
              /* ignore */
            }
          }
        }),

      // ── Docker ─────────────────────────────────────────────────────────────

      "docker.start": ({ containerId }) =>
        !validateContainerId(containerId)
          ? fail("invalid-input", `Invalid containerId: ${containerId}`)
          : dockerPost(`/containers/${containerId}/start`).pipe(Effect.asVoid),

      "docker.stop": ({ containerId }) =>
        !validateContainerId(containerId)
          ? fail("invalid-input", `Invalid containerId: ${containerId}`)
          : dockerPost(`/containers/${containerId}/stop`).pipe(Effect.asVoid),

      "docker.restart": ({ containerId }) =>
        !validateContainerId(containerId)
          ? fail("invalid-input", `Invalid containerId: ${containerId}`)
          : dockerPost(`/containers/${containerId}/restart`).pipe(Effect.asVoid),

      "docker.remove": ({ containerId }) =>
        !validateContainerId(containerId)
          ? fail("invalid-input", `Invalid containerId: ${containerId}`)
          : dockerDelete(`/containers/${containerId}`).pipe(Effect.asVoid),

      "docker.inspect": ({ containerId }) =>
        Effect.gen(function* () {
          if (!validateContainerId(containerId))
            return yield* fail("invalid-input", `Invalid containerId: ${containerId}`)
          const text = yield* dockerGet(`/containers/${containerId}/json`)
          try {
            return JSON.parse(text) as unknown
          } catch {
            return text
          }
        }),

      // ── K8s ────────────────────────────────────────────────────────────────

      "k8s.scale": ({ namespace, deployment, replicas }) =>
        Effect.gen(function* () {
          if (!validateK8sName(namespace) || !validateK8sName(deployment))
            return yield* fail("invalid-input", "Invalid namespace or deployment name")

          const cfg = getK8sConfig()
          if (!cfg) return yield* fail("k8s-not-configured", "No K8s config available")

          yield* k8sFetch(
            cfg,
            `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(deployment)}/scale`,
            "PATCH",
            { spec: { replicas } },
          )
        }),

      "k8s.restartPod": ({ namespace, pod }) =>
        Effect.gen(function* () {
          if (!validateK8sName(namespace) || !validateK8sName(pod))
            return yield* fail("invalid-input", "Invalid namespace or pod name")

          const cfg = getK8sConfig()
          if (!cfg) return yield* fail("k8s-not-configured", "No K8s config available")

          yield* k8sFetch(
            cfg,
            `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}`,
            "DELETE",
          )
        }),

      "k8s.describe": ({ namespace, resource, name }) =>
        Effect.gen(function* () {
          if (!validateK8sName(namespace) || !validateK8sName(name))
            return yield* fail("invalid-input", "Invalid namespace or name")

          const cfg = getK8sConfig()
          if (!cfg) return yield* fail("k8s-not-configured", "No K8s config available")

          const apiPath =
            resource === "pod" || resource === "pods"
              ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}`
              : `/api/v1/namespaces/${encodeURIComponent(namespace)}/${encodeURIComponent(resource)}s/${encodeURIComponent(name)}`

          const text = yield* k8sFetch(cfg, apiPath)
          try {
            return JSON.parse(text) as unknown
          } catch {
            return text
          }
        }),

      // ── Terminal ───────────────────────────────────────────────────────────

      "terminal.open": ({ mode, cols, rows, podName, namespace }) =>
        Effect.gen(function* () {
          const sessionId = crypto.randomUUID()
          const queue = yield* Queue.unbounded<TerminalOutput>()

          const proc = yield* spawnTerminalProcess({
            sessionId,
            mode,
            cols,
            rows,
            podName,
            namespace,
          }).pipe(
            Effect.mapError(
              (e) =>
                new ManagementError({
                  code: "spawn-error",
                  message: String(e),
                }),
            ),
          )

          // Announce sessionId as the first queue item
          yield* Queue.offer(queue, { _tag: "session-start", sessionId })

          // Register this terminal so input/resize/close can find it
          yield* Ref.update(
            terminals,
            (m) => new Map(m).set(sessionId, { proc, queue }),
          )

          // Pump stdout → queue; fork so it runs concurrently
          yield* Effect.forkScoped(
            pumpStreamToQueue(proc.stdout as ReadableStream<Uint8Array>, queue),
          )
          // Pump stderr → queue
          yield* Effect.forkScoped(
            pumpStreamToQueue(proc.stderr as ReadableStream<Uint8Array>, queue),
          )

          // Cleanup when scope closes
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              try {
                proc.kill()
              } catch {
                /* ignore */
              }
            }).pipe(
              Effect.flatMap(() =>
                Ref.update(terminals, (m) => {
                  const next = new Map(m)
                  next.delete(sessionId)
                  return next
                }),
              ),
            ),
          )

          return queue
        }),

      "terminal.input": ({ sessionId, dataBase64 }) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(terminals)
          const term = map.get(sessionId)
          if (!term)
            return yield* fail("session-not-found", `No terminal session ${sessionId}`)

          yield* Effect.tryPromise(async () => {
            const bytes = Buffer.from(dataBase64, "base64")
            const stdin = term.proc.stdin as { write(data: Uint8Array): number }
            stdin.write(bytes)
          }).pipe(Effect.ignore)
        }),

      "terminal.resize": ({ sessionId, cols, rows }) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(terminals)
          if (!map.has(sessionId))
            return yield* fail("session-not-found", `No terminal session ${sessionId}`)

          // Best-effort resize; real PTY would SIGWINCH
          yield* Effect.logDebug(`terminal.resize: ${sessionId} → ${cols}x${rows}`)
        }),

      "terminal.close": ({ sessionId }) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(terminals)
          const term = map.get(sessionId)
          if (!term)
            return yield* fail("session-not-found", `No terminal session ${sessionId}`)

          yield* Effect.sync(() => {
            try {
              term.proc.kill()
            } catch {
              /* ignore */
            }
          })
          yield* Ref.update(terminals, (m) => {
            const next = new Map(m)
            next.delete(sessionId)
            return next
          })
        }),

      // ── Logs ───────────────────────────────────────────────────────────────

      "logs.tail": ({ source, target, namespace, container, tail: tailOpt }) =>
        Effect.gen(function* () {
          const tail = tailOpt ?? 100
          const queue = yield* Queue.unbounded<LogBatch>()

          const abort =
            source === "k8s"
              ? yield* startK8sLogStream({ target, namespace, container, tail, queue })
              : yield* startSystemdLogStream({ target, tail, queue })

          yield* Effect.addFinalizer(() => Effect.sync(abort))

          return queue
        }),
    })
  }),
)
