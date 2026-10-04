import type { EntitySnapshot, EventRecord } from "@scout/plugin-sdk"
import { K8S_ENTITY_KINDS } from "@scout/plugin-k8s/contracts"
import type { StatusTone } from "@/components/status-dot"

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0)

/** Namespace of a namespaced entity; the plugin ids them `<namespace>/<name>`. */
export const namespaceOf = (entity: EntitySnapshot): string => {
  const fromSpec = record(entity.spec)["namespace"]
  if (typeof fromSpec === "string") return fromSpec
  const slash = entity.ref.id.indexOf("/")
  return slash === -1 ? "" : entity.ref.id.slice(0, slash)
}

export interface Workload {
  readonly entity: EntitySnapshot
  readonly name: string
  readonly namespace: string
  readonly kind: string
  readonly ready: number
  readonly desired: number
  readonly status: string
}

/** Deployments as workloads with ready / desired replica counts. */
export function workloadsOf(entities: ReadonlyArray<EntitySnapshot>): ReadonlyArray<Workload> {
  return entities
    .filter((entity) => entity.ref.kind === K8S_ENTITY_KINDS.deployment)
    .map((entity) => ({
      entity,
      name: entity.displayName ?? entity.ref.id,
      namespace: namespaceOf(entity),
      kind: "Deployment",
      ready: num(record(entity.state)["readyReplicas"]),
      desired: num(record(entity.spec)["replicas"]),
      status: entity.status ?? "unknown",
    }))
    .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name))
}

export function workloadTone(workload: Pick<Workload, "status">): StatusTone {
  switch (workload.status) {
    case "ready":
    case "scaled-to-zero":
      return "ok"
    case "progressing":
      return "warn"
    case "unavailable":
      return "err"
    default:
      return "off"
  }
}

export interface NamespaceSummary {
  readonly name: string
  readonly workloads: ReadonlyArray<Workload>
  readonly readyWorkloads: number
  readonly pods: number
  readonly readyPods: number
  readonly tone: StatusTone
}

/** One row per namespace: its workloads and how many pods are ready. */
export function summarizeNamespaces(entities: ReadonlyArray<EntitySnapshot>): ReadonlyArray<NamespaceSummary> {
  const workloads = workloadsOf(entities)
  const pods = entities.filter((entity) => entity.ref.kind === K8S_ENTITY_KINDS.pod)
  const names = new Set<string>([
    ...entities.filter((entity) => entity.ref.kind === K8S_ENTITY_KINDS.namespace).map((entity) => entity.ref.id),
    ...workloads.map((workload) => workload.namespace),
    ...pods.map(namespaceOf),
  ])
  return [...names]
    .filter((name) => name.length > 0)
    .map((name) => {
      const own = workloads.filter((workload) => workload.namespace === name)
      const ownPods = pods.filter((pod) => namespaceOf(pod) === name)
      const readyWorkloads = own.filter((workload) => workload.status === "ready" || workload.status === "scaled-to-zero").length
      const readyPods = ownPods.filter((pod) => pod.status === "ready" || pod.status === "succeeded").length
      const tone: StatusTone =
        own.some((workload) => workload.status === "unavailable")
          ? "err"
          : readyWorkloads < own.length || readyPods < ownPods.length
            ? "warn"
            : own.length + ownPods.length > 0
              ? "ok"
              : "off"
      return { name, workloads: own, readyWorkloads, pods: ownPods.length, readyPods, tone }
    })
    .filter((summary) => summary.workloads.length > 0 || summary.pods > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function podTone(pod: EntitySnapshot): StatusTone {
  switch (pod.status) {
    case "ready":
    case "succeeded":
      return "ok"
    case "pending":
    case "running":
      return "warn"
    case "failed":
      return "err"
    default:
      return "off"
  }
}

/**
 * The k8s collector re-reports an event on every collection and the hub stores
 * each report, so the same event arrives many times. Keep one per identity.
 */
export function uniqueEvents(events: ReadonlyArray<EventRecord>): ReadonlyArray<EventRecord> {
  const seen = new Map<string, EventRecord>()
  for (const event of events) {
    const key = `${event.eventId}|${event.entity?.kind ?? ""}|${event.entity?.id ?? ""}|${event.ts}|${event.message ?? ""}`
    if (!seen.has(key)) seen.set(key, event)
  }
  return [...seen.values()]
}
