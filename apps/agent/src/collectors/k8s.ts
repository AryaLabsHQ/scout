import { Effect } from "effect"
import fs from "node:fs"
import os from "node:os"
import type { CollectorPlugin, CollectorReport, K8sWorkloadMetrics } from "@scout/shared"
import type {
  K8sContainer,
  K8sDeployment,
  K8sIngress,
  K8sJob,
  K8sNode,
  K8sPod,
  K8sService,
} from "@scout/shared"

// ---------------------------------------------------------------------------
// K8s API raw types (internal)
// ---------------------------------------------------------------------------

interface K8sObjectMeta {
  name?: string
  namespace?: string
  creationTimestamp?: string
}

interface K8sListResponse<T> {
  items?: T[]
}

interface RawPod {
  metadata?: K8sObjectMeta
  spec?: {
    nodeName?: string
    containers?: Array<{
      name?: string
      image?: string
    }>
  }
  status?: {
    phase?: string
    containerStatuses?: Array<{
      name?: string
      image?: string
      ready?: boolean
      restartCount?: number
      state?: {
        running?: { startedAt?: string }
        waiting?: { reason?: string }
        terminated?: { reason?: string }
      }
    }>
  }
}

interface RawDeployment {
  metadata?: K8sObjectMeta
  spec?: { replicas?: number }
  status?: {
    desiredReplicas?: number
    readyReplicas?: number
    updatedReplicas?: number
    replicas?: number
  }
}

interface RawService {
  metadata?: K8sObjectMeta
  spec?: {
    type?: string
    clusterIP?: string
    ports?: Array<{
      name?: string
      port?: number
      targetPort?: number | string
      protocol?: string
    }>
  }
}

interface RawIngress {
  metadata?: K8sObjectMeta
  spec?: {
    rules?: Array<{
      host?: string
      http?: {
        paths?: Array<{
          path?: string
          backend?: {
            service?: { name?: string; port?: { number?: number } }
          }
        }>
      }
    }>
  }
}

interface RawJob {
  metadata?: K8sObjectMeta
  spec?: { completions?: number }
  status?: {
    succeeded?: number
    failed?: number
    active?: number
    startTime?: string
    completionTime?: string
  }
}

interface RawNode {
  metadata?: K8sObjectMeta & { labels?: Record<string, string> }
  status?: {
    allocatable?: { cpu?: string; memory?: string }
    conditions?: Array<{ type?: string; status?: string }>
  }
}

interface RawPodMetrics {
  metadata?: K8sObjectMeta
  containers?: Array<{
    usage?: { cpu?: string; memory?: string }
  }>
}

// ---------------------------------------------------------------------------
// Auth / connection resolution
// ---------------------------------------------------------------------------

interface K8sConfig {
  baseUrl: string
  headers: Record<string, string>
}

function resolveK8sConfig(): K8sConfig | null {
  // In-cluster: use ServiceAccount token + well-known env vars
  const tokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token"
  if (fs.existsSync(tokenPath)) {
    try {
      const token = fs.readFileSync(tokenPath, "utf8").trim()
      const host = process.env["KUBERNETES_SERVICE_HOST"] ?? "kubernetes.default.svc"
      const port = process.env["KUBERNETES_SERVICE_PORT"] ?? "443"
      return {
        baseUrl: `https://${host}:${port}`,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    } catch {
      // fall through
    }
  }

  // Out-of-cluster: minimal kubeconfig parsing (current-context server + token/cert)
  const kubeconfigPath =
    process.env["KUBECONFIG"] ||
    `${os.homedir()}/.kube/config`

  if (fs.existsSync(kubeconfigPath)) {
    try {
      // Very basic YAML parsing — extract server and token from kubeconfig
      const raw = fs.readFileSync(kubeconfigPath, "utf8")
      const serverMatch = raw.match(/\bserver:\s*(\S+)/)
      const tokenMatch = raw.match(/\btoken:\s*(\S+)/)
      if (serverMatch?.[1]) {
        const cfg: K8sConfig = {
          baseUrl: serverMatch[1],
          headers: {},
        }
        if (tokenMatch?.[1]) {
          cfg.headers["Authorization"] = `Bearer ${tokenMatch[1]}`
        }
        return cfg
      }
    } catch {
      // fall through
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// I/O helper
// ---------------------------------------------------------------------------

const k8sFetch = (cfg: K8sConfig, path: string): Effect.Effect<string> =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(`${cfg.baseUrl}${path}`, {
        headers: cfg.headers,
      })
      return res.text()
    },
    catch: (e) => new Error(`K8s API ${path} failed: ${String(e)}`),
  }).pipe(Effect.orDie)

// ---------------------------------------------------------------------------
// Age helper
// ---------------------------------------------------------------------------

function ageSeconds(timestamp: string | undefined): number {
  if (!timestamp) return 0
  const created = new Date(timestamp).getTime()
  if (isNaN(created)) return 0
  return Math.max(0, Math.floor((Date.now() - created) / 1000))
}

// ---------------------------------------------------------------------------
// Pure parsers
// ---------------------------------------------------------------------------

/**
 * Parse K8s `GET /api/v1/pods` response.
 */
export function parseK8sPodList(json: string): K8sPod[] {
  let parsed: K8sListResponse<RawPod>
  try {
    parsed = JSON.parse(json) as K8sListResponse<RawPod>
  } catch {
    return []
  }
  if (!Array.isArray(parsed.items)) return []

  return parsed.items.map(pod => {
    const name = pod.metadata?.name ?? ""
    const namespace = pod.metadata?.namespace ?? ""
    const nodeName = pod.spec?.nodeName ?? ""
    const phase = normalizePodPhase(pod.status?.phase)
    const age = ageSeconds(pod.metadata?.creationTimestamp)

    const containerStatuses = pod.status?.containerStatuses ?? []
    const specContainers = pod.spec?.containers ?? []

    const containers: K8sContainer[] = specContainers.map(sc => {
      const cs = containerStatuses.find(s => s.name === sc.name)
      const state = cs?.state
      let stateStr: K8sContainer["state"] = "waiting"
      let reason: string | null = null

      if (state?.running) {
        stateStr = "running"
      } else if (state?.terminated) {
        stateStr = "terminated"
        reason = state.terminated.reason ?? null
      } else if (state?.waiting) {
        stateStr = "waiting"
        reason = state.waiting.reason ?? null
      }

      return {
        name: sc.name ?? "",
        image: sc.image ?? cs?.image ?? "",
        ready: cs?.ready ?? false,
        restartCount: cs?.restartCount ?? 0,
        state: stateStr,
        reason,
      }
    })

    const restarts = containers.reduce((sum, c) => sum + c.restartCount, 0)

    return {
      name,
      namespace,
      nodeName,
      phase,
      restarts,
      containers,
      cpuMillicores: null,
      memBytes: null,
      age,
    }
  })
}

function normalizePodPhase(phase: string | undefined): K8sPod["phase"] {
  switch (phase) {
    case "Pending": return "Pending"
    case "Running": return "Running"
    case "Succeeded": return "Succeeded"
    case "Failed": return "Failed"
    default: return "Unknown"
  }
}

/**
 * Parse K8s `GET /apis/apps/v1/deployments` response.
 */
export function parseK8sDeploymentList(json: string): K8sDeployment[] {
  let parsed: K8sListResponse<RawDeployment>
  try {
    parsed = JSON.parse(json) as K8sListResponse<RawDeployment>
  } catch {
    return []
  }
  if (!Array.isArray(parsed.items)) return []

  return parsed.items.map(d => ({
    name: d.metadata?.name ?? "",
    namespace: d.metadata?.namespace ?? "",
    desiredReplicas: d.spec?.replicas ?? d.status?.desiredReplicas ?? 0,
    readyReplicas: d.status?.readyReplicas ?? 0,
    updatedReplicas: d.status?.updatedReplicas ?? 0,
    age: ageSeconds(d.metadata?.creationTimestamp),
  }))
}

/**
 * Parse K8s `GET /api/v1/services` response.
 */
export function parseK8sServiceList(json: string): K8sService[] {
  let parsed: K8sListResponse<RawService>
  try {
    parsed = JSON.parse(json) as K8sListResponse<RawService>
  } catch {
    return []
  }
  if (!Array.isArray(parsed.items)) return []

  return parsed.items.map(svc => ({
    name: svc.metadata?.name ?? "",
    namespace: svc.metadata?.namespace ?? "",
    type: normalizeServiceType(svc.spec?.type),
    clusterIP: svc.spec?.clusterIP ?? "",
    ports: (svc.spec?.ports ?? []).map(p => ({
      name: p.name,
      port: p.port ?? 0,
      targetPort: typeof p.targetPort === "number" ? p.targetPort : Number(p.targetPort) || 0,
      protocol: p.protocol ?? "TCP",
    })),
  }))
}

function normalizeServiceType(t: string | undefined): K8sService["type"] {
  switch (t) {
    case "ClusterIP": return "ClusterIP"
    case "NodePort": return "NodePort"
    case "LoadBalancer": return "LoadBalancer"
    case "ExternalName": return "ExternalName"
    default: return "ClusterIP"
  }
}

/**
 * Parse K8s `GET /apis/networking.k8s.io/v1/ingresses` response.
 */
export function parseK8sIngressList(json: string): K8sIngress[] {
  let parsed: K8sListResponse<RawIngress>
  try {
    parsed = JSON.parse(json) as K8sListResponse<RawIngress>
  } catch {
    return []
  }
  if (!Array.isArray(parsed.items)) return []

  return parsed.items.map(ing => ({
    name: ing.metadata?.name ?? "",
    namespace: ing.metadata?.namespace ?? "",
    rules: (ing.spec?.rules ?? []).map(rule => ({
      host: rule.host ?? "",
      paths: (rule.http?.paths ?? []).map(p => ({
        path: p.path ?? "/",
        backend: p.backend?.service?.name ?? "",
        port: p.backend?.service?.port?.number ?? 0,
      })),
    })),
  }))
}

/**
 * Parse K8s `GET /apis/batch/v1/jobs` response.
 */
export function parseK8sJobList(json: string): K8sJob[] {
  let parsed: K8sListResponse<RawJob>
  try {
    parsed = JSON.parse(json) as K8sListResponse<RawJob>
  } catch {
    return []
  }
  if (!Array.isArray(parsed.items)) return []

  return parsed.items.map(job => {
    let duration: number | null = null
    if (job.status?.startTime) {
      const start = new Date(job.status.startTime).getTime()
      const end = job.status.completionTime
        ? new Date(job.status.completionTime).getTime()
        : Date.now()
      if (!isNaN(start) && !isNaN(end)) {
        duration = Math.max(0, Math.floor((end - start) / 1000))
      }
    }

    return {
      name: job.metadata?.name ?? "",
      namespace: job.metadata?.namespace ?? "",
      completions: job.spec?.completions ?? 0,
      succeeded: job.status?.succeeded ?? 0,
      failed: job.status?.failed ?? 0,
      active: job.status?.active ?? 0,
      duration,
    }
  })
}

/**
 * Parse K8s `GET /api/v1/nodes` response.
 */
export function parseK8sNodeList(json: string): K8sNode[] {
  let parsed: K8sListResponse<RawNode>
  try {
    parsed = JSON.parse(json) as K8sListResponse<RawNode>
  } catch {
    return []
  }
  if (!Array.isArray(parsed.items)) return []

  return parsed.items.map(node => {
    const conditions = (node.status?.conditions ?? []).map(c => ({
      type: c.type ?? "",
      status: c.status ?? "",
    }))

    const readyCond = conditions.find(c => c.type === "Ready")
    let status: K8sNode["status"] = "Unknown"
    if (readyCond?.status === "True") status = "Ready"
    else if (readyCond?.status === "False") status = "NotReady"

    // Roles from labels: node-role.kubernetes.io/<role>
    const labels = (node.metadata as (K8sObjectMeta & { labels?: Record<string, string> }) | undefined)?.labels ?? {}
    const roles = Object.keys(labels)
      .filter(k => k.startsWith("node-role.kubernetes.io/"))
      .map(k => k.replace("node-role.kubernetes.io/", ""))

    return {
      name: node.metadata?.name ?? "",
      status,
      roles: roles.length > 0 ? roles : ["worker"],
      allocatable: {
        cpu: node.status?.allocatable?.cpu ?? "0",
        memory: node.status?.allocatable?.memory ?? "0",
      },
      conditions,
    }
  })
}

/**
 * Apply pod metrics (from metrics-server) onto K8sPod[].
 * Modifies in-place: sets cpuMillicores and memBytes where matched.
 */
function applyPodMetrics(pods: K8sPod[], metricsJson: string): void {
  let parsed: K8sListResponse<RawPodMetrics>
  try {
    parsed = JSON.parse(metricsJson) as K8sListResponse<RawPodMetrics>
    if (!Array.isArray(parsed.items)) return
  } catch {
    return
  }

  for (const m of parsed.items) {
    const name = m.metadata?.name
    const namespace = m.metadata?.namespace
    if (!name) continue

    const pod = pods.find(p => p.name === name && p.namespace === (namespace ?? ""))
    if (!pod) continue

    let totalCpu = 0
    let totalMem = 0
    for (const c of m.containers ?? []) {
      totalCpu += parseCpuString(c.usage?.cpu)
      totalMem += parseMemoryString(c.usage?.memory)
    }
    pod.cpuMillicores = totalCpu
    pod.memBytes = totalMem
  }
}

function parseCpuString(cpu: string | undefined): number {
  if (!cpu) return 0
  if (cpu.endsWith("n")) return Math.round(Number(cpu.slice(0, -1)) / 1_000_000) // nanocores → millicores
  if (cpu.endsWith("m")) return Number(cpu.slice(0, -1)) // already millicores
  return Math.round(Number(cpu) * 1000) // cores → millicores
}

function parseMemoryString(mem: string | undefined): number {
  if (!mem) return 0
  if (mem.endsWith("Ki")) return Number(mem.slice(0, -2)) * 1024
  if (mem.endsWith("Mi")) return Number(mem.slice(0, -2)) * 1024 * 1024
  if (mem.endsWith("Gi")) return Number(mem.slice(0, -2)) * 1024 * 1024 * 1024
  if (mem.endsWith("Ti")) return Number(mem.slice(0, -2)) * 1024 * 1024 * 1024 * 1024
  if (mem.endsWith("k")) return Number(mem.slice(0, -1)) * 1000
  if (mem.endsWith("M")) return Number(mem.slice(0, -1)) * 1_000_000
  if (mem.endsWith("G")) return Number(mem.slice(0, -1)) * 1_000_000_000
  return Number(mem)
}

// ---------------------------------------------------------------------------
// CollectorPlugin
// ---------------------------------------------------------------------------

export const k8sCollector: CollectorPlugin = {
  name: "k8s",
  capability: "k8s",
  detect: Effect.sync(
    () =>
      fs.existsSync("/var/run/secrets/kubernetes.io/serviceaccount/token") ||
      Boolean(process.env["KUBECONFIG"] && fs.existsSync(process.env["KUBECONFIG"])) ||
      fs.existsSync(`${os.homedir()}/.kube/config`),
  ),
  collect: Effect.gen(function* () {
    const cfg = resolveK8sConfig()
    if (!cfg) {
      yield* Effect.die("No K8s config available")
      // unreachable, but needed for TS to narrow cfg
      throw new Error("unreachable")
    }

    const fetch_ = (path: string) => k8sFetch(cfg, path)

    const [
      podsJson,
      deploymentsJson,
      servicesJson,
      ingressesJson,
      jobsJson,
      nodesJson,
    ] = yield* Effect.all([
      fetch_("/api/v1/pods"),
      fetch_("/apis/apps/v1/deployments"),
      fetch_("/api/v1/services"),
      fetch_("/apis/networking.k8s.io/v1/ingresses"),
      fetch_("/apis/batch/v1/jobs"),
      fetch_("/api/v1/nodes"),
    ])

    const pods = parseK8sPodList(podsJson)
    const deployments = parseK8sDeploymentList(deploymentsJson)
    const services = parseK8sServiceList(servicesJson)
    const ingresses = parseK8sIngressList(ingressesJson)
    const jobs = parseK8sJobList(jobsJson)
    const nodes = parseK8sNodeList(nodesJson)

    // Try metrics-server — best effort, ignore failures
    const metricsJson = yield* fetch_("/apis/metrics.k8s.io/v1beta1/pods").pipe(
      Effect.orElseSucceed(() => "{}"),
    )
    applyPodMetrics(pods, metricsJson)

    const data: K8sWorkloadMetrics = { pods, deployments, services, ingresses, jobs, nodes }
    return { capability: "k8s" as const, data } satisfies CollectorReport
  }),
} satisfies CollectorPlugin

export type { K8sWorkloadMetrics }
