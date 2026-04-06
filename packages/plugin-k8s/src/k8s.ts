import { spawn } from "node:child_process"
import { Effect, Stream } from "effect"
import {
  type EventRecord,
  LogChunkSchema,
  type MetricPoint,
  PluginExecutionError,
  type EntityRef,
  type ActionTarget,
  type LogChunk,
  type PluginCapability,
  type PluginCollectionResult,
  type ScoutActionHandler,
  type ScoutAgentPlugin,
  type ScoutStreamHandler,
} from "@scout/plugin-sdk"
import {
  EmptyInputSchema,
  K8S_ACTION_IDS,
  K8S_ENTITY_KINDS,
  K8S_METRIC_IDS,
  K8S_PLUGIN_ID,
  K8S_STREAM_IDS,
  PodLogsInputSchema,
  ScaleWorkloadInputSchema,
  TextOutputSchema,
} from "./contracts.js"
import { manifest } from "./manifest.js"

const K8S_FEATURES = [
  "inventory.cluster",
  "inventory.namespaces",
  "inventory.nodes",
  "inventory.pods",
  "inventory.deployments",
  "inventory.services",
  "inventory.ingresses",
  "inventory.jobs",
  "relationships.explicit",
] as const

const RELATIONSHIP_TYPES = {
  contains: "contains",
  containedBy: "contained-by",
  hosts: "hosts",
  runsOn: "runs-on",
  manages: "manages",
  managedBy: "managed-by",
  selects: "selects",
  selectedBy: "selected-by",
  exposes: "exposes",
  exposedBy: "exposed-by",
} as const

interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface K8sDependencies {
  readonly exec: (
    command: string,
    args: ReadonlyArray<string>,
  ) => Effect.Effect<CommandResult, Error>
}

interface KubeList<T> {
  readonly items?: ReadonlyArray<T>
}

interface KubeOwnerReference {
  readonly kind?: string
  readonly name?: string
  readonly uid?: string
  readonly controller?: boolean
}

interface KubeMetadata {
  readonly uid?: string
  readonly name?: string
  readonly namespace?: string
  readonly labels?: Record<string, string>
  readonly annotations?: Record<string, string>
  readonly ownerReferences?: ReadonlyArray<KubeOwnerReference>
}

interface KubeConfigView {
  readonly "current-context"?: string
  readonly contexts?: ReadonlyArray<{
    readonly name?: string
    readonly context?: {
      readonly cluster?: string
      readonly namespace?: string
      readonly user?: string
    }
  }>
  readonly clusters?: ReadonlyArray<{
    readonly name?: string
    readonly cluster?: {
      readonly server?: string
    }
  }>
}

interface KubeClusterInfo {
  readonly id: string
  readonly name: string
  readonly currentContext?: string
  readonly defaultNamespace?: string
  readonly server?: string
}

interface KubeNamespace {
  readonly metadata?: KubeMetadata
  readonly status?: {
    readonly phase?: string
  }
}

interface KubeNode {
  readonly metadata?: KubeMetadata
  readonly spec?: {
    readonly providerID?: string
    readonly podCIDR?: string
    readonly unschedulable?: boolean
    readonly taints?: ReadonlyArray<{
      readonly effect?: string
      readonly key?: string
      readonly value?: string
    }>
  }
  readonly status?: {
    readonly conditions?: ReadonlyArray<{
      readonly type?: string
      readonly status?: string
    }>
    readonly addresses?: ReadonlyArray<{
      readonly address?: string
      readonly type?: string
    }>
    readonly nodeInfo?: {
      readonly kubeletVersion?: string
      readonly kernelVersion?: string
      readonly osImage?: string
      readonly containerRuntimeVersion?: string
    }
  }
}

interface KubePod {
  readonly metadata?: KubeMetadata
  readonly spec?: {
    readonly nodeName?: string
    readonly serviceAccountName?: string
    readonly containers?: ReadonlyArray<{
      readonly name?: string
      readonly image?: string
    }>
  }
  readonly status?: {
    readonly phase?: string
    readonly podIP?: string
    readonly hostIP?: string
    readonly conditions?: ReadonlyArray<{
      readonly type?: string
      readonly status?: string
    }>
    readonly containerStatuses?: ReadonlyArray<{
      readonly name?: string
      readonly ready?: boolean
      readonly restartCount?: number
    }>
  }
}

interface KubeDeployment {
  readonly metadata?: KubeMetadata
  readonly spec?: {
    readonly replicas?: number
    readonly strategy?: {
      readonly type?: string
    }
    readonly selector?: {
      readonly matchLabels?: Record<string, string>
    }
  }
  readonly status?: {
    readonly readyReplicas?: number
    readonly availableReplicas?: number
    readonly updatedReplicas?: number
    readonly replicas?: number
  }
}

interface KubeService {
  readonly metadata?: KubeMetadata
  readonly spec?: {
    readonly type?: string
    readonly clusterIP?: string
    readonly selector?: Record<string, string>
    readonly ports?: ReadonlyArray<{
      readonly name?: string
      readonly port?: number
      readonly protocol?: string
      readonly targetPort?: string | number
    }>
  }
  readonly status?: {
    readonly loadBalancer?: {
      readonly ingress?: ReadonlyArray<{
        readonly hostname?: string
        readonly ip?: string
      }>
    }
  }
}

interface KubeIngressBackend {
  readonly service?: {
    readonly name?: string
    readonly port?: {
      readonly name?: string
      readonly number?: number
    }
  }
}

interface KubeIngress {
  readonly metadata?: KubeMetadata
  readonly spec?: {
    readonly ingressClassName?: string
    readonly defaultBackend?: KubeIngressBackend
    readonly tls?: ReadonlyArray<{
      readonly hosts?: ReadonlyArray<string>
      readonly secretName?: string
    }>
    readonly rules?: ReadonlyArray<{
      readonly host?: string
      readonly http?: {
        readonly paths?: ReadonlyArray<{
          readonly path?: string
          readonly pathType?: string
          readonly backend?: KubeIngressBackend
        }>
      }
    }>
  }
  readonly status?: {
    readonly loadBalancer?: {
      readonly ingress?: ReadonlyArray<{
        readonly hostname?: string
        readonly ip?: string
      }>
    }
  }
}

interface KubeJob {
  readonly metadata?: KubeMetadata
  readonly spec?: {
    readonly parallelism?: number
    readonly completions?: number
    readonly backoffLimit?: number
  }
  readonly status?: {
    readonly active?: number
    readonly failed?: number
    readonly succeeded?: number
    readonly startTime?: string
    readonly completionTime?: string
    readonly conditions?: ReadonlyArray<{
      readonly type?: string
      readonly status?: string
    }>
  }
}

interface KubeEvent {
  readonly metadata?: KubeMetadata
  readonly reason?: string
  readonly message?: string
  readonly note?: string
  readonly type?: string
  readonly eventTime?: string | null
  readonly firstTimestamp?: string
  readonly lastTimestamp?: string
  readonly count?: number
  readonly involvedObject?: {
    readonly kind?: string
    readonly name?: string
    readonly namespace?: string
  }
}

export interface K8sResourceSnapshot {
  readonly cluster: KubeClusterInfo
  readonly namespaces: ReadonlyArray<KubeNamespace>
  readonly nodes: ReadonlyArray<KubeNode>
  readonly pods: ReadonlyArray<KubePod>
  readonly deployments: ReadonlyArray<KubeDeployment>
  readonly services: ReadonlyArray<KubeService>
  readonly ingresses: ReadonlyArray<KubeIngress>
  readonly jobs: ReadonlyArray<KubeJob>
  readonly events: ReadonlyArray<KubeEvent>
}

interface MutableEntitySnapshot {
  readonly ref: EntityRef
  readonly ts: number
  displayName?: string
  status?: string
  labels?: Record<string, string>
  spec?: unknown
  state?: unknown
  relationships?: Array<{
    readonly type: string
    readonly target: EntityRef
  }>
}

const makeExecutionError = (code: string, message: string) =>
  new PluginExecutionError({
    code,
    message,
    pluginId: K8S_PLUGIN_ID,
  })

const makeDefaultDependencies = (): K8sDependencies => ({
  exec: (command, args) =>
    Effect.tryPromise({
      try: async () => {
        const proc = spawn(command, [...args], {
          stdio: ["ignore", "pipe", "pipe"],
        })
        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []

        proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk))
        proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk))

        const exitCode = await new Promise<number>((resolve, reject) => {
          proc.on("error", reject)
          proc.on("close", (code) => resolve(code ?? 1))
        })

        return {
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          exitCode,
        }
      },
      catch: (error) => new Error(`Failed to run ${command}: ${String(error)}`),
    }),
})

const entityRef = (nodeId: string, kind: string, id: string): EntityRef => ({
  pluginId: K8S_PLUGIN_ID,
  kind,
  nodeId,
  id,
})

const entityKey = (ref: EntityRef): string => `${ref.kind}:${ref.id}`

const namespacedId = (namespace: string, name: string): string => `${namespace}/${name}`

const isNonEmptyRecord = (
  value: Record<string, string> | undefined,
): value is Record<string, string> => value !== undefined && Object.keys(value).length > 0

const getMetadataName = (metadata: KubeMetadata | undefined): string | undefined => metadata?.name?.trim()

const getMetadataNamespace = (metadata: KubeMetadata | undefined): string | undefined =>
  metadata?.namespace?.trim()

const getReadyConditionStatus = (
  conditions: ReadonlyArray<{ readonly type?: string; readonly status?: string }> | undefined,
): string | undefined => conditions?.find((condition) => condition.type === "Ready")?.status

const matchesSelector = (
  selector: Record<string, string> | undefined,
  labels: Record<string, string> | undefined,
): boolean =>
  selector !== undefined &&
  Object.keys(selector).length > 0 &&
  Object.entries(selector).every(([key, value]) => labels?.[key] === value)

const parseJson = <T>(raw: string, label: string): Effect.Effect<T, PluginExecutionError> =>
  Effect.try({
    try: () => JSON.parse(raw) as T,
    catch: (error) =>
      makeExecutionError("invalid-json", `Failed to parse ${label} JSON: ${String(error)}`),
  })

const parseListItems = <T>(
  raw: string,
  label: string,
): Effect.Effect<ReadonlyArray<T>, PluginExecutionError> =>
  parseJson<KubeList<T>>(raw, label).pipe(
    Effect.flatMap((value) =>
      Array.isArray(value.items)
        ? Effect.succeed(value.items)
        : Effect.fail(
            makeExecutionError("invalid-list", `kubectl returned an invalid ${label} list payload`),
          ),
    ),
  )

const parseClusterInfo = (config: KubeConfigView): KubeClusterInfo => {
  const currentContext = config["current-context"]?.trim()
  const activeContext = config.contexts?.find((context) => context.name === currentContext)
  const clusterName = activeContext?.context?.cluster?.trim()
  const cluster = config.clusters?.find((entry) => entry.name === clusterName)
  const id = clusterName || currentContext || "cluster"

  return {
    id,
    name: clusterName || currentContext || "Kubernetes Cluster",
    ...(currentContext !== undefined && { currentContext }),
    ...(activeContext?.context?.namespace !== undefined && {
      defaultNamespace: activeContext.context.namespace,
    }),
    ...(cluster?.cluster?.server !== undefined && { server: cluster.cluster.server }),
  }
}

const runKubectl = (
  deps: K8sDependencies,
  args: ReadonlyArray<string>,
): Effect.Effect<string, PluginExecutionError> =>
  deps.exec("kubectl", args).pipe(
    Effect.flatMap(({ stdout, stderr, exitCode }) =>
      exitCode === 0
        ? Effect.succeed(stdout)
        : Effect.fail(
            makeExecutionError(
              "command-failed",
              `kubectl ${args.join(" ")} exited with ${exitCode}: ${stderr.trim() || stdout.trim() || "unknown error"}`,
            ),
          ),
    ),
    Effect.mapError((error) =>
      error instanceof PluginExecutionError
        ? error
        : makeExecutionError("command-error", String(error)),
    ),
  )

const readSnapshot = (
  deps: K8sDependencies,
): Effect.Effect<K8sResourceSnapshot, PluginExecutionError> =>
  Effect.all({
    cluster: runKubectl(deps, ["config", "view", "--minify", "-o", "json"]).pipe(
      Effect.flatMap((raw) => parseJson<KubeConfigView>(raw, "config")),
      Effect.map(parseClusterInfo),
    ),
    namespaces: runKubectl(deps, ["get", "namespaces", "-o", "json"]).pipe(
      Effect.flatMap((raw) => parseListItems<KubeNamespace>(raw, "namespaces")),
    ),
    nodes: runKubectl(deps, ["get", "nodes", "-o", "json"]).pipe(
      Effect.flatMap((raw) => parseListItems<KubeNode>(raw, "nodes")),
    ),
    pods: runKubectl(deps, ["get", "pods", "--all-namespaces", "-o", "json"]).pipe(
      Effect.flatMap((raw) => parseListItems<KubePod>(raw, "pods")),
    ),
    deployments: runKubectl(deps, ["get", "deployments.apps", "--all-namespaces", "-o", "json"]).pipe(
      Effect.flatMap((raw) => parseListItems<KubeDeployment>(raw, "deployments")),
    ),
    services: runKubectl(deps, ["get", "services", "--all-namespaces", "-o", "json"]).pipe(
      Effect.flatMap((raw) => parseListItems<KubeService>(raw, "services")),
    ),
    ingresses: runKubectl(
      deps,
      ["get", "ingresses.networking.k8s.io", "--all-namespaces", "-o", "json"],
    ).pipe(Effect.flatMap((raw) => parseListItems<KubeIngress>(raw, "ingresses"))),
    jobs: runKubectl(deps, ["get", "jobs.batch", "--all-namespaces", "-o", "json"]).pipe(
      Effect.flatMap((raw) => parseListItems<KubeJob>(raw, "jobs")),
    ),
    events: runKubectl(deps, ["get", "events", "--all-namespaces", "-o", "json"]).pipe(
      Effect.flatMap((raw) => parseListItems<KubeEvent>(raw, "events")),
      Effect.orElseSucceed(() => []),
    ),
  })

const namespaceStatus = (namespace: KubeNamespace): string => namespace.status?.phase?.toLowerCase() ?? "unknown"

const nodeStatus = (node: KubeNode): string => {
  const ready = getReadyConditionStatus(node.status?.conditions)
  if (ready === "True") return "ready"
  if (ready === "False") return "not-ready"
  return "unknown"
}

const podStatus = (pod: KubePod): string => {
  const phase = pod.status?.phase?.toLowerCase() ?? "unknown"
  return phase === "running" && getReadyConditionStatus(pod.status?.conditions) === "True"
    ? "ready"
    : phase
}

const deploymentStatus = (deployment: KubeDeployment): string => {
  const desired = deployment.spec?.replicas ?? 1
  const ready = deployment.status?.readyReplicas ?? 0
  const available = deployment.status?.availableReplicas ?? 0

  if (desired === 0) return "scaled-to-zero"
  if (ready >= desired && available >= desired) return "ready"
  if (ready > 0 || available > 0) return "progressing"
  return "unavailable"
}

const serviceStatus = (service: KubeService): string => {
  if (service.spec?.type !== "LoadBalancer") return "active"
  return (service.status?.loadBalancer?.ingress?.length ?? 0) > 0 ? "ready" : "pending"
}

const ingressStatus = (ingress: KubeIngress): string =>
  (ingress.status?.loadBalancer?.ingress?.length ?? 0) > 0 ? "ready" : "pending"

const jobStatus = (job: KubeJob): string => {
  const completionTarget = job.spec?.completions ?? 1
  const succeeded = job.status?.succeeded ?? 0
  const failed = job.status?.failed ?? 0
  const active = job.status?.active ?? 0
  const hasFailedCondition = job.status?.conditions?.some(
    (condition) => condition.type === "Failed" && condition.status === "True",
  )

  if (succeeded >= completionTarget && completionTarget > 0) return "complete"
  if (hasFailedCondition === true || failed > 0) return "failed"
  if (active > 0) return "running"
  return "pending"
}

const serviceBackends = (ingress: KubeIngress): ReadonlyArray<string> => {
  const backendNames = new Set<string>()
  const defaultBackend = ingress.spec?.defaultBackend?.service?.name
  if (defaultBackend !== undefined && defaultBackend.length > 0) {
    backendNames.add(defaultBackend)
  }

  for (const rule of ingress.spec?.rules ?? []) {
    for (const path of rule.http?.paths ?? []) {
      const serviceName = path.backend?.service?.name
      if (serviceName !== undefined && serviceName.length > 0) {
        backendNames.add(serviceName)
      }
    }
  }

  return [...backendNames]
}

const podRestarts = (pod: KubePod): number =>
  (pod.status?.containerStatuses ?? []).reduce(
    (total, status) => total + (status.restartCount ?? 0),
    0,
  )

const isReadyConditionTrue = (
  conditions: ReadonlyArray<{ readonly type?: string; readonly status?: string }> | undefined,
): boolean => getReadyConditionStatus(conditions) === "True"

const toTimestamp = (value: string | null | undefined, fallback: number): number => {
  if (value === null || value === undefined) return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const mapEventEntityKind = (kind: string | undefined): string | undefined => {
  switch (kind?.toLowerCase()) {
    case "namespace":
      return K8S_ENTITY_KINDS.namespace
    case "node":
      return K8S_ENTITY_KINDS.node
    case "pod":
      return K8S_ENTITY_KINDS.pod
    case "deployment":
      return K8S_ENTITY_KINDS.deployment
    case "service":
      return K8S_ENTITY_KINDS.service
    case "ingress":
      return K8S_ENTITY_KINDS.ingress
    case "job":
      return K8S_ENTITY_KINDS.job
    default:
      return undefined
  }
}

const splitNamespacedId = (value: string): { readonly namespace: string; readonly name: string } | null => {
  const separator = value.indexOf("/")
  if (separator <= 0 || separator === value.length - 1) return null
  return {
    namespace: value.slice(0, separator),
    name: value.slice(separator + 1),
  }
}

const requireTargetEntity = (
  target: ActionTarget,
  actionId: string,
): Effect.Effect<EntityRef, PluginExecutionError> =>
  target.entity === undefined
    ? Effect.fail(
        makeExecutionError("invalid-target", `Action "${actionId}" requires a target entity`),
      )
    : Effect.succeed(target.entity)

const requireNamespacedTarget = (
  target: ActionTarget,
  actionId: string,
): Effect.Effect<{ readonly ref: EntityRef; readonly namespace: string; readonly name: string }, PluginExecutionError> =>
  requireTargetEntity(target, actionId).pipe(
    Effect.flatMap((ref) => {
      const parsed = splitNamespacedId(ref.id)
      return parsed === null
        ? Effect.fail(
            makeExecutionError(
              "invalid-target",
              `Action "${actionId}" requires a namespaced target id`,
            ),
          )
        : Effect.succeed({ ref, ...parsed })
    }),
  )

const kubectlResource = (kind: string): string | null => {
  switch (kind) {
    case K8S_ENTITY_KINDS.namespace:
      return "namespace"
    case K8S_ENTITY_KINDS.node:
      return "node"
    case K8S_ENTITY_KINDS.pod:
      return "pod"
    case K8S_ENTITY_KINDS.deployment:
      return "deployment"
    case K8S_ENTITY_KINDS.statefulset:
      return "statefulset"
    case K8S_ENTITY_KINDS.daemonset:
      return "daemonset"
    case K8S_ENTITY_KINDS.service:
      return "service"
    case K8S_ENTITY_KINDS.ingress:
      return "ingress"
    case K8S_ENTITY_KINDS.job:
      return "job"
    case K8S_ENTITY_KINDS.cronjob:
      return "cronjob"
    default:
      return null
  }
}

const describeArgsForTarget = (
  target: ActionTarget,
): Effect.Effect<ReadonlyArray<string>, PluginExecutionError> =>
  requireTargetEntity(target, K8S_ACTION_IDS.describeResource).pipe(
    Effect.flatMap((ref) => {
      if (ref.kind === K8S_ENTITY_KINDS.cluster) {
        return Effect.succeed<ReadonlyArray<string>>(["cluster-info"])
      }

      const resource = kubectlResource(ref.kind)
      if (resource === null) {
        return Effect.fail(
          makeExecutionError("invalid-target", `Unsupported describe target kind "${ref.kind}"`),
        )
      }

      if (ref.kind === K8S_ENTITY_KINDS.namespace || ref.kind === K8S_ENTITY_KINDS.node) {
        return Effect.succeed<ReadonlyArray<string>>(["describe", resource, ref.id])
      }

      const parsed = splitNamespacedId(ref.id)
      return parsed === null
        ? Effect.fail(
            makeExecutionError(
              "invalid-target",
              `Describe target "${ref.id}" must include a namespace`,
            ),
          )
        : Effect.succeed<ReadonlyArray<string>>([
            "describe",
            resource,
            parsed.name,
            "-n",
            parsed.namespace,
          ])
    }),
  )

export const materializeK8sCollection = (
  nodeId: string,
  ts: number,
  snapshot: K8sResourceSnapshot,
): PluginCollectionResult => {
  const entities = new Map<string, MutableEntitySnapshot>()
  const relationshipKeys = new Map<string, Set<string>>()
  const metrics: MetricPoint[] = []
  const events: EventRecord[] = []

  const upsertEntity = (entity: MutableEntitySnapshot): void => {
    entities.set(entityKey(entity.ref), entity)
    relationshipKeys.set(entityKey(entity.ref), new Set<string>())
  }

  const addRelationship = (source: EntityRef, type: string, target: EntityRef): void => {
    const sourceEntity = entities.get(entityKey(source))
    const targetEntity = entities.get(entityKey(target))
    const seen = relationshipKeys.get(entityKey(source))
    if (sourceEntity === undefined || targetEntity === undefined || seen === undefined) return

    const key = `${type}:${target.kind}:${target.id}`
    if (seen.has(key)) return
    seen.add(key)
    sourceEntity.relationships ??= []
    sourceEntity.relationships.push({ type, target })
  }

  const addBidirectionalRelationship = (
    source: EntityRef,
    sourceType: string,
    target: EntityRef,
    targetType: string,
  ): void => {
    addRelationship(source, sourceType, target)
    addRelationship(target, targetType, source)
  }

  const clusterRef = entityRef(nodeId, K8S_ENTITY_KINDS.cluster, snapshot.cluster.id)
  upsertEntity({
    ref: clusterRef,
    ts,
    displayName: snapshot.cluster.name,
    status: "connected",
    spec: {
      ...(snapshot.cluster.currentContext !== undefined && {
        currentContext: snapshot.cluster.currentContext,
      }),
      ...(snapshot.cluster.defaultNamespace !== undefined && {
        defaultNamespace: snapshot.cluster.defaultNamespace,
      }),
      ...(snapshot.cluster.server !== undefined && { server: snapshot.cluster.server }),
    },
    state: {
      currentContext: snapshot.cluster.currentContext ?? null,
      defaultNamespace: snapshot.cluster.defaultNamespace ?? null,
      server: snapshot.cluster.server ?? null,
    },
  })

  const namespaceRefs = new Map<string, EntityRef>()
  for (const namespace of snapshot.namespaces) {
    const name = getMetadataName(namespace.metadata)
    if (name === undefined) continue
    const ref = entityRef(nodeId, K8S_ENTITY_KINDS.namespace, name)
    namespaceRefs.set(name, ref)
    upsertEntity({
      ref,
      ts,
      displayName: name,
      status: namespaceStatus(namespace),
      ...(isNonEmptyRecord(namespace.metadata?.labels) && { labels: namespace.metadata.labels }),
      state: {
        phase: namespace.status?.phase ?? null,
      },
    })
    addBidirectionalRelationship(
      clusterRef,
      RELATIONSHIP_TYPES.contains,
      ref,
      RELATIONSHIP_TYPES.containedBy,
    )
  }

  const nodeRefs = new Map<string, EntityRef>()
  for (const node of snapshot.nodes) {
    const name = getMetadataName(node.metadata)
    if (name === undefined) continue
    const ref = entityRef(nodeId, K8S_ENTITY_KINDS.node, name)
    nodeRefs.set(name, ref)
    upsertEntity({
      ref,
      ts,
      displayName: name,
      status: nodeStatus(node),
      ...(isNonEmptyRecord(node.metadata?.labels) && { labels: node.metadata.labels }),
      spec: {
        providerId: node.spec?.providerID ?? null,
        podCIDR: node.spec?.podCIDR ?? null,
        unschedulable: node.spec?.unschedulable ?? false,
        taints: (node.spec?.taints ?? []).map((taint) => ({
          key: taint.key ?? null,
          value: taint.value ?? null,
          effect: taint.effect ?? null,
        })),
      },
      state: {
        addresses: (node.status?.addresses ?? []).map((address) => ({
          type: address.type ?? null,
          address: address.address ?? null,
        })),
        kubeletVersion: node.status?.nodeInfo?.kubeletVersion ?? null,
        kernelVersion: node.status?.nodeInfo?.kernelVersion ?? null,
        osImage: node.status?.nodeInfo?.osImage ?? null,
        containerRuntimeVersion: node.status?.nodeInfo?.containerRuntimeVersion ?? null,
        readyCondition: getReadyConditionStatus(node.status?.conditions) ?? null,
      },
    })
    addBidirectionalRelationship(
      clusterRef,
      RELATIONSHIP_TYPES.contains,
      ref,
      RELATIONSHIP_TYPES.containedBy,
    )
  }

  const deploymentRefs = new Map<string, EntityRef>()
  for (const deployment of snapshot.deployments) {
    const namespace = getMetadataNamespace(deployment.metadata)
    const name = getMetadataName(deployment.metadata)
    if (namespace === undefined || name === undefined) continue
    const ref = entityRef(nodeId, K8S_ENTITY_KINDS.deployment, namespacedId(namespace, name))
    deploymentRefs.set(ref.id, ref)
    upsertEntity({
      ref,
      ts,
      displayName: name,
      status: deploymentStatus(deployment),
      ...(isNonEmptyRecord(deployment.metadata?.labels) && { labels: deployment.metadata.labels }),
      spec: {
        namespace,
        replicas: deployment.spec?.replicas ?? 1,
        strategy: deployment.spec?.strategy?.type ?? null,
        selector: deployment.spec?.selector?.matchLabels ?? null,
      },
      state: {
        readyReplicas: deployment.status?.readyReplicas ?? 0,
        availableReplicas: deployment.status?.availableReplicas ?? 0,
        updatedReplicas: deployment.status?.updatedReplicas ?? 0,
        replicas: deployment.status?.replicas ?? 0,
      },
    })

    const namespaceRef = namespaceRefs.get(namespace)
    if (namespaceRef !== undefined) {
      addBidirectionalRelationship(
        namespaceRef,
        RELATIONSHIP_TYPES.contains,
        ref,
        RELATIONSHIP_TYPES.containedBy,
      )
    }
  }

  const serviceRefs = new Map<string, EntityRef>()
  for (const service of snapshot.services) {
    const namespace = getMetadataNamespace(service.metadata)
    const name = getMetadataName(service.metadata)
    if (namespace === undefined || name === undefined) continue
    const ref = entityRef(nodeId, K8S_ENTITY_KINDS.service, namespacedId(namespace, name))
    serviceRefs.set(ref.id, ref)
    upsertEntity({
      ref,
      ts,
      displayName: name,
      status: serviceStatus(service),
      ...(isNonEmptyRecord(service.metadata?.labels) && { labels: service.metadata.labels }),
      spec: {
        namespace,
        type: service.spec?.type ?? null,
        clusterIP: service.spec?.clusterIP ?? null,
        selector: service.spec?.selector ?? null,
        ports: (service.spec?.ports ?? []).map((port) => ({
          name: port.name ?? null,
          port: port.port ?? null,
          protocol: port.protocol ?? null,
          targetPort: port.targetPort ?? null,
        })),
      },
      state: {
        loadBalancerIngress: (service.status?.loadBalancer?.ingress ?? []).map((entry) => ({
          hostname: entry.hostname ?? null,
          ip: entry.ip ?? null,
        })),
      },
    })

    const namespaceRef = namespaceRefs.get(namespace)
    if (namespaceRef !== undefined) {
      addBidirectionalRelationship(
        namespaceRef,
        RELATIONSHIP_TYPES.contains,
        ref,
        RELATIONSHIP_TYPES.containedBy,
      )
    }
  }

  const ingressRefs = new Map<string, EntityRef>()
  for (const ingress of snapshot.ingresses) {
    const namespace = getMetadataNamespace(ingress.metadata)
    const name = getMetadataName(ingress.metadata)
    if (namespace === undefined || name === undefined) continue
    const ref = entityRef(nodeId, K8S_ENTITY_KINDS.ingress, namespacedId(namespace, name))
    ingressRefs.set(ref.id, ref)
    upsertEntity({
      ref,
      ts,
      displayName: name,
      status: ingressStatus(ingress),
      ...(isNonEmptyRecord(ingress.metadata?.labels) && { labels: ingress.metadata.labels }),
      spec: {
        namespace,
        ingressClassName: ingress.spec?.ingressClassName ?? null,
        hosts: [
          ...new Set([
            ...(ingress.spec?.tls ?? []).flatMap((tls) => tls.hosts ?? []),
            ...(ingress.spec?.rules ?? []).flatMap((rule) =>
              rule.host === undefined ? [] : [rule.host],
            ),
          ]),
        ],
        backends: serviceBackends(ingress),
      },
      state: {
        loadBalancerIngress: (ingress.status?.loadBalancer?.ingress ?? []).map((entry) => ({
          hostname: entry.hostname ?? null,
          ip: entry.ip ?? null,
        })),
      },
    })

    const namespaceRef = namespaceRefs.get(namespace)
    if (namespaceRef !== undefined) {
      addBidirectionalRelationship(
        namespaceRef,
        RELATIONSHIP_TYPES.contains,
        ref,
        RELATIONSHIP_TYPES.containedBy,
      )
    }
  }

  const jobRefs = new Map<string, EntityRef>()
  for (const job of snapshot.jobs) {
    const namespace = getMetadataNamespace(job.metadata)
    const name = getMetadataName(job.metadata)
    if (namespace === undefined || name === undefined) continue
    const ref = entityRef(nodeId, K8S_ENTITY_KINDS.job, namespacedId(namespace, name))
    jobRefs.set(ref.id, ref)
    upsertEntity({
      ref,
      ts,
      displayName: name,
      status: jobStatus(job),
      ...(isNonEmptyRecord(job.metadata?.labels) && { labels: job.metadata.labels }),
      spec: {
        namespace,
        parallelism: job.spec?.parallelism ?? null,
        completions: job.spec?.completions ?? null,
        backoffLimit: job.spec?.backoffLimit ?? null,
      },
      state: {
        active: job.status?.active ?? 0,
        succeeded: job.status?.succeeded ?? 0,
        failed: job.status?.failed ?? 0,
        startTime: job.status?.startTime ?? null,
        completionTime: job.status?.completionTime ?? null,
      },
    })

    const namespaceRef = namespaceRefs.get(namespace)
    if (namespaceRef !== undefined) {
      addBidirectionalRelationship(
        namespaceRef,
        RELATIONSHIP_TYPES.contains,
        ref,
        RELATIONSHIP_TYPES.containedBy,
      )
    }
  }

  const podRefs = new Map<string, EntityRef>()
  for (const pod of snapshot.pods) {
    const namespace = getMetadataNamespace(pod.metadata)
    const name = getMetadataName(pod.metadata)
    if (namespace === undefined || name === undefined) continue
    const ref = entityRef(nodeId, K8S_ENTITY_KINDS.pod, namespacedId(namespace, name))
    podRefs.set(ref.id, ref)
    upsertEntity({
      ref,
      ts,
      displayName: name,
      status: podStatus(pod),
      ...(isNonEmptyRecord(pod.metadata?.labels) && { labels: pod.metadata.labels }),
      spec: {
        namespace,
        nodeName: pod.spec?.nodeName ?? null,
        serviceAccountName: pod.spec?.serviceAccountName ?? null,
        containers: (pod.spec?.containers ?? []).map((container) => ({
          name: container.name ?? null,
          image: container.image ?? null,
        })),
      },
      state: {
        phase: pod.status?.phase ?? null,
        podIP: pod.status?.podIP ?? null,
        hostIP: pod.status?.hostIP ?? null,
        ready: getReadyConditionStatus(pod.status?.conditions) === "True",
        restarts: podRestarts(pod),
        owners: (pod.metadata?.ownerReferences ?? []).map((owner) => ({
          kind: owner.kind ?? null,
          name: owner.name ?? null,
          uid: owner.uid ?? null,
          controller: owner.controller ?? false,
        })),
      },
    })

    const namespaceRef = namespaceRefs.get(namespace)
    if (namespaceRef !== undefined) {
      addBidirectionalRelationship(
        namespaceRef,
        RELATIONSHIP_TYPES.contains,
        ref,
        RELATIONSHIP_TYPES.containedBy,
      )
    }

    const nodeName = pod.spec?.nodeName?.trim()
    if (nodeName !== undefined && nodeName.length > 0) {
      const nodeRef = nodeRefs.get(nodeName)
      if (nodeRef !== undefined) {
        addBidirectionalRelationship(nodeRef, RELATIONSHIP_TYPES.hosts, ref, RELATIONSHIP_TYPES.runsOn)
      }
    }
  }

  for (const deployment of snapshot.deployments) {
    const namespace = getMetadataNamespace(deployment.metadata)
    const name = getMetadataName(deployment.metadata)
    if (namespace === undefined || name === undefined) continue
    const deploymentRef = deploymentRefs.get(namespacedId(namespace, name))
    if (deploymentRef === undefined) continue

    for (const pod of snapshot.pods) {
      const podNamespace = getMetadataNamespace(pod.metadata)
      const podName = getMetadataName(pod.metadata)
      if (podNamespace !== namespace || podName === undefined) continue
      if (!matchesSelector(deployment.spec?.selector?.matchLabels, pod.metadata?.labels)) continue
      const podRef = podRefs.get(namespacedId(namespace, podName))
      if (podRef !== undefined) {
        addBidirectionalRelationship(
          deploymentRef,
          RELATIONSHIP_TYPES.manages,
          podRef,
          RELATIONSHIP_TYPES.managedBy,
        )
      }
    }
  }

  for (const service of snapshot.services) {
    const namespace = getMetadataNamespace(service.metadata)
    const name = getMetadataName(service.metadata)
    if (namespace === undefined || name === undefined) continue
    const serviceRef = serviceRefs.get(namespacedId(namespace, name))
    if (serviceRef === undefined) continue

    for (const pod of snapshot.pods) {
      const podNamespace = getMetadataNamespace(pod.metadata)
      const podName = getMetadataName(pod.metadata)
      if (podNamespace !== namespace || podName === undefined) continue
      if (!matchesSelector(service.spec?.selector, pod.metadata?.labels)) continue
      const podRef = podRefs.get(namespacedId(namespace, podName))
      if (podRef !== undefined) {
        addBidirectionalRelationship(
          serviceRef,
          RELATIONSHIP_TYPES.selects,
          podRef,
          RELATIONSHIP_TYPES.selectedBy,
        )
      }
    }
  }

  for (const ingress of snapshot.ingresses) {
    const namespace = getMetadataNamespace(ingress.metadata)
    const name = getMetadataName(ingress.metadata)
    if (namespace === undefined || name === undefined) continue
    const ingressRef = ingressRefs.get(namespacedId(namespace, name))
    if (ingressRef === undefined) continue

    for (const backendService of serviceBackends(ingress)) {
      const serviceRef = serviceRefs.get(namespacedId(namespace, backendService))
      if (serviceRef !== undefined) {
        addBidirectionalRelationship(
          ingressRef,
          RELATIONSHIP_TYPES.exposes,
          serviceRef,
          RELATIONSHIP_TYPES.exposedBy,
        )
      }
    }
  }

  for (const job of snapshot.jobs) {
    const namespace = getMetadataNamespace(job.metadata)
    const name = getMetadataName(job.metadata)
    if (namespace === undefined || name === undefined) continue
    const jobRef = jobRefs.get(namespacedId(namespace, name))
    if (jobRef === undefined) continue

    for (const pod of snapshot.pods) {
      const podNamespace = getMetadataNamespace(pod.metadata)
      const podName = getMetadataName(pod.metadata)
      if (podNamespace !== namespace || podName === undefined) continue

      const podOwners = pod.metadata?.ownerReferences ?? []
      const ownedByJob = podOwners.some(
        (owner) => owner.kind === "Job" && owner.name === name && owner.controller === true,
      )
      const matchesJobLabel = pod.metadata?.labels?.["job-name"] === name
      if (!ownedByJob && !matchesJobLabel) continue

      const podRef = podRefs.get(namespacedId(namespace, podName))
      if (podRef !== undefined) {
        addBidirectionalRelationship(
          jobRef,
          RELATIONSHIP_TYPES.manages,
          podRef,
          RELATIONSHIP_TYPES.managedBy,
        )
      }
    }
  }

  const readyNodes = snapshot.nodes.filter((node) =>
    isReadyConditionTrue(node.status?.conditions),
  ).length

  metrics.push({
    pluginId: K8S_PLUGIN_ID,
    metricId: K8S_METRIC_IDS.clusterNodesReady,
    ts,
    entity: clusterRef,
    value: readyNodes,
    unit: "count",
  })

  for (const node of snapshot.nodes) {
    const name = getMetadataName(node.metadata)
    if (name === undefined) continue
    const ref = nodeRefs.get(name)
    if (ref === undefined) continue

    metrics.push({
      pluginId: K8S_PLUGIN_ID,
      metricId: K8S_METRIC_IDS.nodeReady,
      ts,
      entity: ref,
      value: isReadyConditionTrue(node.status?.conditions) ? 1 : 0,
    })
  }

  for (const namespace of snapshot.namespaces) {
    const name = getMetadataName(namespace.metadata)
    if (name === undefined) continue
    const ref = namespaceRefs.get(name)
    if (ref === undefined) continue

    const readyDeployments = snapshot.deployments.filter(
      (deployment) =>
        getMetadataNamespace(deployment.metadata) === name &&
        deploymentStatus(deployment) === "ready",
    ).length
    const completeJobs = snapshot.jobs.filter(
      (job) =>
        getMetadataNamespace(job.metadata) === name &&
        jobStatus(job) === "complete",
    ).length

    metrics.push({
      pluginId: K8S_PLUGIN_ID,
      metricId: K8S_METRIC_IDS.namespaceWorkloadsReady,
      ts,
      entity: ref,
      value: readyDeployments + completeJobs,
      unit: "count",
    })
  }

  for (const deployment of snapshot.deployments) {
    const namespace = getMetadataNamespace(deployment.metadata)
    const name = getMetadataName(deployment.metadata)
    if (namespace === undefined || name === undefined) continue
    const ref = deploymentRefs.get(namespacedId(namespace, name))
    if (ref === undefined) continue

    metrics.push({
      pluginId: K8S_PLUGIN_ID,
      metricId: K8S_METRIC_IDS.workloadReplicasReady,
      ts,
      entity: ref,
      value: deployment.status?.readyReplicas ?? 0,
      unit: "count",
    })
  }

  for (const pod of snapshot.pods) {
    const namespace = getMetadataNamespace(pod.metadata)
    const name = getMetadataName(pod.metadata)
    if (namespace === undefined || name === undefined) continue
    const ref = podRefs.get(namespacedId(namespace, name))
    if (ref === undefined) continue

    metrics.push({
      pluginId: K8S_PLUGIN_ID,
      metricId: K8S_METRIC_IDS.podReady,
      ts,
      entity: ref,
      value: isReadyConditionTrue(pod.status?.conditions) ? 1 : 0,
    })
    metrics.push({
      pluginId: K8S_PLUGIN_ID,
      metricId: K8S_METRIC_IDS.podRestartsTotal,
      ts,
      entity: ref,
      value: podRestarts(pod),
      unit: "count",
    })
  }

  for (const event of snapshot.events) {
    const entityKind = mapEventEntityKind(event.involvedObject?.kind)
    const eventName = event.involvedObject?.name?.trim()
    const eventNamespace = event.involvedObject?.namespace?.trim()
    const entityId =
      entityKind === undefined || eventName === undefined || eventName.length === 0
        ? undefined
        : entityKind === K8S_ENTITY_KINDS.namespace || entityKind === K8S_ENTITY_KINDS.node
          ? eventName
          : eventNamespace !== undefined && eventNamespace.length > 0
            ? namespacedId(eventNamespace, eventName)
            : eventName

    events.push({
      pluginId: K8S_PLUGIN_ID,
      eventId: event.reason?.trim().toLowerCase() || "k8s.event",
      ts: toTimestamp(
        event.eventTime ?? event.lastTimestamp ?? event.firstTimestamp,
        ts,
      ),
      ...(entityKind !== undefined && entityId !== undefined
        ? { entity: entityRef(nodeId, entityKind, entityId) }
        : {}),
      severity:
        event.type?.toLowerCase() === "warning"
          ? "warning"
          : event.type?.toLowerCase() === "error"
            ? "error"
            : "info",
      ...(event.message !== undefined || event.note !== undefined
        ? { message: event.message ?? event.note }
        : {}),
      payload: {
        reason: event.reason ?? null,
        type: event.type ?? null,
        count: event.count ?? null,
      },
    })
  }

  return {
    entities: [...entities.values()].map((entity) =>
      entity.relationships === undefined || entity.relationships.length === 0
        ? { ...entity }
        : {
            ...entity,
            relationships: [...entity.relationships].sort((left, right) =>
              `${left.type}:${left.target.kind}:${left.target.id}`.localeCompare(
                `${right.type}:${right.target.kind}:${right.target.id}`,
              ),
            ),
          },
    ),
    metrics,
    events,
  }
}

export const createK8sAgentPlugin = (
  overrides: Partial<K8sDependencies> = {},
): ScoutAgentPlugin<PluginExecutionError> => {
  const deps = { ...makeDefaultDependencies(), ...overrides } satisfies K8sDependencies

  const availableCapability = (): PluginCapability => ({
    pluginId: K8S_PLUGIN_ID,
    version: manifest.version,
    status: "available",
    features: [...K8S_FEATURES],
  })

  const degradedCapability = (reason: string): PluginCapability => ({
    pluginId: K8S_PLUGIN_ID,
    version: manifest.version,
    status: "degraded",
    features: [...K8S_FEATURES],
    reason,
  })

  const unsupportedCapability = (reason: string): PluginCapability => ({
    pluginId: K8S_PLUGIN_ID,
    version: manifest.version,
    status: "unsupported",
    features: [],
    reason,
  })

  const detect = (): Effect.Effect<PluginCapability> =>
    deps.exec("kubectl", ["version", "--client=true", "--output=json"]).pipe(
      Effect.matchEffect({
        onFailure: (error: Error) =>
          Effect.succeed(unsupportedCapability(String(error.message || error))),
        onSuccess: ({ exitCode, stderr }) => {
          if (exitCode !== 0) {
            return Effect.succeed(
              unsupportedCapability(stderr.trim() || "kubectl is not available on this node"),
            )
          }

          return deps.exec("kubectl", ["config", "current-context"]).pipe(
            Effect.map(({ stdout, exitCode: contextExitCode, stderr: contextStderr }) =>
              contextExitCode === 0 && stdout.trim().length > 0
                ? availableCapability()
                : degradedCapability(
                    contextStderr.trim() ||
                      "kubectl is installed but no current context is configured",
                  ),
            ),
            Effect.orElseSucceed(() =>
              degradedCapability("kubectl is installed but current context detection failed"),
            ),
          )
        },
      }),
    )

  const collect = (ctx: { readonly nodeId: string; readonly now: number }) =>
    readSnapshot(deps).pipe(
      Effect.map((snapshot) => materializeK8sCollection(ctx.nodeId, ctx.now, snapshot)),
    )

  const actions: ReadonlyArray<ScoutActionHandler<unknown, unknown, PluginExecutionError>> = [
    {
      definition: manifest.actions.find((action) => action.id === K8S_ACTION_IDS.describeResource)!,
      inputSchema: EmptyInputSchema,
      outputSchema: TextOutputSchema,
      execute: (_ctx, target: ActionTarget) =>
        describeArgsForTarget(target).pipe(
          Effect.flatMap((args) => runKubectl(deps, args)),
          Effect.map((text) => ({ text })),
        ),
    },
    {
      definition: manifest.actions.find((action) => action.id === K8S_ACTION_IDS.scaleWorkload)!,
      inputSchema: ScaleWorkloadInputSchema,
      outputSchema: EmptyInputSchema,
      execute: (_ctx, target: ActionTarget, input: unknown) =>
        requireNamespacedTarget(target, K8S_ACTION_IDS.scaleWorkload).pipe(
          Effect.flatMap(({ ref, namespace, name }) => {
            const resource = kubectlResource(ref.kind)
            if (resource === null) {
              return Effect.fail(
                makeExecutionError("invalid-target", `Unsupported scale target kind "${ref.kind}"`),
              )
            }
            return runKubectl(deps, [
              "scale",
              resource,
              name,
              "-n",
              namespace,
              "--replicas",
              String((input as { replicas: number }).replicas),
            ]).pipe(Effect.as({}))
          }),
        ),
    },
    {
      definition: manifest.actions.find((action) => action.id === K8S_ACTION_IDS.restartPod)!,
      inputSchema: EmptyInputSchema,
      outputSchema: EmptyInputSchema,
      execute: (_ctx, target: ActionTarget) =>
        requireNamespacedTarget(target, K8S_ACTION_IDS.restartPod).pipe(
          Effect.flatMap(({ name, namespace }) =>
            runKubectl(deps, ["delete", "pod", name, "-n", namespace]).pipe(Effect.as({})),
          ),
        ),
    },
    {
      definition: manifest.actions.find((action) => action.id === K8S_ACTION_IDS.deletePod)!,
      inputSchema: EmptyInputSchema,
      outputSchema: EmptyInputSchema,
      execute: (_ctx, target: ActionTarget) =>
        requireNamespacedTarget(target, K8S_ACTION_IDS.deletePod).pipe(
          Effect.flatMap(({ name, namespace }) =>
            runKubectl(deps, ["delete", "pod", name, "-n", namespace]).pipe(Effect.as({})),
          ),
        ),
    },
  ]

  const streams: ReadonlyArray<ScoutStreamHandler<unknown, LogChunk, PluginExecutionError>> = [
    {
      definition: manifest.streams.find((stream) => stream.id === K8S_STREAM_IDS.podLogs)!,
      inputSchema: PodLogsInputSchema,
      chunkSchema: LogChunkSchema,
      open: (_ctx, target: ActionTarget, input: unknown) =>
        Stream.unwrap(
          requireNamespacedTarget(target, K8S_STREAM_IDS.podLogs).pipe(
            Effect.flatMap(({ name, namespace }) =>
              runKubectl(deps, [
                "logs",
                name,
                "-n",
                namespace,
                "--tail",
                String((input as { tail?: number }).tail ?? 200),
                ...((input as { container?: string }).container !== undefined
                  ? ["-c", (input as { container?: string }).container!]
                  : []),
              ]),
            ),
            Effect.map((stdout) =>
              Stream.succeed({
                lines: stdout
                  .split("\n")
                  .map((line) => line.trimEnd())
                  .filter((line) => line.length > 0),
                ts: Date.now(),
              }),
            ),
          ),
        ),
    },
  ]

  return {
    detect,
    collect,
    actions,
    streams,
  } satisfies ScoutAgentPlugin<PluginExecutionError>
}

export const k8s = createK8sAgentPlugin()
