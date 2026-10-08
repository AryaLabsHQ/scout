import { spawn } from "node:child_process"
import { Effect, Stream } from "effect"
import {
  type ActionTarget,
  followProcessLines,
  LogChunkSchema,
  type MetricPoint,
  type PluginCapability,
  type PluginCollectionResult,
  type ScoutActionHandler,
  type ScoutAgentPlugin,
  type ScoutStreamHandler,
  type LogChunk,
  PluginExecutionError,
} from "@scout/plugin-sdk"
import {
  CommandOutputSchema,
  ContainerLogsInputSchema,
  DOCKER_ENTITY_KINDS,
  DOCKER_FEATURES,
  DOCKER_ACTION_IDS,
  DOCKER_METRIC_IDS,
  DOCKER_PLUGIN_ID,
  DOCKER_STREAM_IDS,
  EmptyInputSchema,
  InspectOutputSchema,
} from "./contracts.js"
import { manifest } from "./manifest.js"

export interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface DockerDependencies {
  readonly exec: (command: string, args: ReadonlyArray<string>) => Effect.Effect<CommandResult, Error>
  readonly followLogs: (containerId: string, tail: number) => Stream.Stream<LogChunk, Error>
}

interface DockerInfo {
  readonly ID?: string
  readonly Name?: string
  readonly ServerVersion?: string
  readonly OperatingSystem?: string
  readonly OSType?: string
  readonly Architecture?: string
  readonly KernelVersion?: string
  readonly DockerRootDir?: string
  readonly Driver?: string
  readonly NCPU?: number
  readonly MemTotal?: number
  readonly Containers?: number
  readonly ContainersRunning?: number
  readonly ContainersPaused?: number
  readonly ContainersStopped?: number
  readonly Images?: number
}

interface DockerContainerInspect {
  readonly Id: string
  readonly Name?: string
  readonly Created?: string
  readonly Image?: string
  readonly RestartCount?: number
  readonly Config?: {
    readonly Hostname?: string
    readonly Image?: string
    readonly Labels?: Record<string, string> | null
  }
  readonly State?: {
    readonly Status?: string
    readonly Running?: boolean
    readonly Paused?: boolean
    readonly Restarting?: boolean
    readonly OOMKilled?: boolean
    readonly Dead?: boolean
    readonly ExitCode?: number
    readonly StartedAt?: string
    readonly FinishedAt?: string
    readonly Health?: {
      readonly Status?: string
    }
  }
  readonly HostConfig?: {
    readonly NetworkMode?: string
  }
  readonly Mounts?: ReadonlyArray<{
    readonly Type?: string
    readonly Name?: string
    readonly Source?: string
    readonly Destination?: string
    readonly RW?: boolean
  }>
  readonly NetworkSettings?: {
    readonly Networks?: Record<
      string,
      {
        readonly NetworkID?: string
        readonly IPAddress?: string
        readonly Gateway?: string
        readonly Aliases?: ReadonlyArray<string>
      }
    >
  }
}

interface DockerContainerStats {
  readonly ID?: string
  readonly Name?: string
  readonly CPUPerc?: string
  readonly MemUsage?: string
  readonly NetIO?: string
}

interface DockerImageInspect {
  readonly Id: string
  readonly Parent?: string
  readonly RepoTags?: ReadonlyArray<string>
  readonly RepoDigests?: ReadonlyArray<string>
  readonly Created?: string
  readonly Size?: number
  readonly SharedSize?: number
  readonly VirtualSize?: number
  readonly Architecture?: string
  readonly Os?: string
  readonly Config?: {
    readonly Labels?: Record<string, string> | null
  }
}

interface DockerVolumeInspect {
  readonly Name: string
  readonly Driver?: string
  readonly CreatedAt?: string
  readonly Labels?: Record<string, string> | null
  readonly Mountpoint?: string
  readonly Scope?: string
  readonly Options?: Record<string, string>
  readonly UsageData?: {
    readonly Size?: number
    readonly RefCount?: number
  } | null
}

interface DockerNetworkInspect {
  readonly Id: string
  readonly Name?: string
  readonly Driver?: string
  readonly Scope?: string
  readonly Internal?: boolean
  readonly EnableIPv6?: boolean
  readonly Labels?: Record<string, string> | null
  readonly Created?: string
  readonly IPAM?: {
    readonly Driver?: string
    readonly Config?: ReadonlyArray<{
      readonly Subnet?: string
      readonly Gateway?: string
    }>
  }
}

type EntityRef = {
  readonly pluginId: string
  readonly kind: string
  readonly nodeId: string
  readonly id: string
}

const makeDefaultDependencies = (): DockerDependencies => ({
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
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }),
  followLogs: (containerId, tail) =>
    followProcessLines("docker", [
      "container",
      "logs",
      "--follow",
      "--timestamps",
      "--tail",
      String(tail),
      containerId,
    ]),
})

export const parseDockerJsonObject = <T>(output: string): T | null => {
  try {
    const parsed: unknown = JSON.parse(output)
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as T
    }
  } catch {
    return null
  }
  return null
}

export const parseDockerInspectArray = <T>(output: string): ReadonlyArray<T> => {
  try {
    const parsed: unknown = JSON.parse(output)
    return Array.isArray(parsed) ? (parsed as ReadonlyArray<T>) : []
  } catch {
    return []
  }
}

export const parseDockerIdList = (output: string): ReadonlyArray<string> => {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const line of output.split("\n")) {
    const value = line.trim()
    if (value.length === 0 || seen.has(value)) continue
    seen.add(value)
    ids.push(value)
  }
  return ids
}

export const parseDockerStatsLines = (output: string): ReadonlyArray<DockerContainerStats> =>
  output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const parsed: unknown = JSON.parse(line)
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
          ? [parsed as DockerContainerStats]
          : []
      } catch {
        return []
      }
    })

const dockerEntityRef = (
  kind: (typeof DOCKER_ENTITY_KINDS)[keyof typeof DOCKER_ENTITY_KINDS],
  nodeId: string,
  id: string,
): EntityRef => ({
  pluginId: DOCKER_PLUGIN_ID,
  kind,
  nodeId,
  id,
})

const normalizeLabels = (labels: Record<string, string> | null | undefined): Record<string, string> => {
  if (labels === null || labels === undefined) return {}

  const entries = Object.entries(labels).filter(([key, value]) => key.length > 0 && typeof value === "string")

  return entries.length > 0 ? Object.fromEntries(entries) : {}
}

const trimCommandFailure = (command: string, args: ReadonlyArray<string>, result: CommandResult): string => {
  const detail = result.stderr.trim() || result.stdout.trim() || "unknown error"
  return `${command} ${args.join(" ")} exited with ${result.exitCode}: ${detail}`
}

const isMissingDockerCommand = (error: Error): boolean =>
  error.message.includes("ENOENT") || /docker(.*)not found/i.test(error.message)

const runDocker = (
  deps: DockerDependencies,
  args: ReadonlyArray<string>,
): Effect.Effect<CommandResult, Error> => deps.exec("docker", args)

const failExecution = (code: string, message: string, opts?: { actionId?: string; streamId?: string }) =>
  new PluginExecutionError({
    code,
    message,
    pluginId: DOCKER_PLUGIN_ID,
    ...(opts?.actionId !== undefined && { actionId: opts.actionId }),
    ...(opts?.streamId !== undefined && { streamId: opts.streamId }),
  })

const parsePercent = (value: string | undefined): number => {
  if (value === undefined) return 0
  const parsed = Number.parseFloat(value.replace("%", "").trim())
  return Number.isFinite(parsed) ? parsed : 0
}

const byteUnitMultipliers: Readonly<Record<string, number>> = {
  b: 1,
  kb: 1_000,
  mb: 1_000_000,
  gb: 1_000_000_000,
  tb: 1_000_000_000_000,
  kib: 1_024,
  mib: 1_048_576,
  gib: 1_073_741_824,
  tib: 1_099_511_627_776,
}

const parseByteValue = (value: string | undefined): number => {
  if (value === undefined) return 0
  const normalized = value.trim().toLowerCase()
  const match = normalized.match(/^([\d.]+)\s*([kmgt]?i?b)?$/)
  if (match === null) return 0
  const amount = Number.parseFloat(match[1] ?? "0")
  const unit = match[2] ?? "b"
  if (!Number.isFinite(amount)) return 0
  return amount * (byteUnitMultipliers[unit] ?? 1)
}

const parseIoPair = (value: string | undefined): readonly [number, number] => {
  if (value === undefined) return [0, 0]
  const [left, right] = value.split("/").map((part) => part.trim())
  return [parseByteValue(left), parseByteValue(right)]
}

const parseTimestampMs = (value: string | undefined): number | null => {
  if (value === undefined || value.length === 0) return null
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : null
}

const runChecked = (
  deps: DockerDependencies,
  args: ReadonlyArray<string>,
  opts?: { actionId?: string },
): Effect.Effect<string, PluginExecutionError> =>
  runDocker(deps, args).pipe(
    Effect.flatMap(({ stdout, stderr, exitCode }) =>
      exitCode === 0
        ? Effect.succeed(stdout)
        : Effect.fail(
            failExecution(
              "command-failed",
              `docker ${args.join(" ")} exited with ${exitCode}: ${stderr.trim() || stdout.trim() || "unknown error"}`,
              opts,
            ),
          ),
    ),
    Effect.mapError((error) =>
      error instanceof PluginExecutionError ? error : failExecution("command-error", String(error), opts),
    ),
  )

const containerUptimeSeconds = (container: DockerContainerInspect, now: number): number => {
  const startedAt = parseTimestampMs(container.State?.StartedAt)
  const createdAt = parseTimestampMs(container.Created)
  const basis = startedAt ?? createdAt
  if (basis === null) return 0
  return Math.max(0, Math.floor((now - basis) / 1000))
}

const getDockerInfo = (deps: DockerDependencies): Effect.Effect<DockerInfo, Error> =>
  runDocker(deps, ["info", "--format", "{{json .}}"]).pipe(
    Effect.flatMap((result) =>
      result.exitCode === 0
        ? Effect.succeed(result)
        : Effect.fail(new Error(trimCommandFailure("docker", ["info", "--format", "{{json .}}"], result))),
    ),
    Effect.flatMap(({ stdout }) => {
      const parsed = parseDockerJsonObject<DockerInfo>(stdout)
      return parsed === null
        ? Effect.fail(new Error("docker info returned invalid JSON"))
        : Effect.succeed(parsed)
    }),
  )

const listDockerIds = (
  deps: DockerDependencies,
  args: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, Error> =>
  runDocker(deps, args).pipe(
    Effect.flatMap((result) =>
      result.exitCode === 0
        ? Effect.succeed(parseDockerIdList(result.stdout))
        : Effect.fail(new Error(trimCommandFailure("docker", args, result))),
    ),
  )

const inspectDockerResources = <T>(
  deps: DockerDependencies,
  scope: "container" | "image" | "volume" | "network",
  ids: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<T>, Error> => {
  if (ids.length === 0) {
    return Effect.succeed([])
  }

  const args = [scope, "inspect", ...ids] as const
  return runDocker(deps, args).pipe(
    Effect.flatMap((result) =>
      result.exitCode === 0
        ? Effect.succeed(parseDockerInspectArray<T>(result.stdout))
        : Effect.fail(new Error(trimCommandFailure("docker", args, result))),
    ),
  )
}

const emptyInventory = (): PluginCollectionResult => ({
  entities: [],
})

const daemonStatus = (): string => "running"

const containerStatus = (container: DockerContainerInspect): string => container.State?.Status ?? "unknown"

const volumeStatus = (volume: DockerVolumeInspect): string =>
  (volume.UsageData?.RefCount ?? 0) > 0 ? "in-use" : "available"

const imageStatus = (): string => "present"

const networkStatus = (): string => "available"

const normalizeContainerName = (name: string | undefined, fallbackId: string): string => {
  const trimmed = name?.trim()
  if (trimmed === undefined || trimmed.length === 0) return fallbackId
  return trimmed.startsWith("/") ? trimmed.slice(1) : trimmed
}

const relationship = (type: string, target: EntityRef) => ({ type, target })

/**
 * Drops keys whose value is `undefined`. Entity `spec` and `state` cross the
 * agent RPC as JSON values, which reject `undefined` properties, and many
 * Docker inspect fields are optional (for example `Parent` is absent on hosts
 * using the containerd image store).
 */
const definedFields = <T extends Record<string, unknown>>(
  fields: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }

const getTargetId = (
  target: ActionTarget,
  kind: string,
  opts?: { actionId?: string; streamId?: string },
): Effect.Effect<string, PluginExecutionError> => {
  const entity = target.entity
  if (entity?.kind !== kind || entity.id.length === 0) {
    return Effect.fail(failExecution("invalid-target", `Docker operation requires a ${kind} target`, opts))
  }
  return Effect.succeed(entity.id)
}

const dedupeRelationships = (
  relationships: ReadonlyArray<ReturnType<typeof relationship>>,
): ReadonlyArray<ReturnType<typeof relationship>> => {
  const seen = new Set<string>()
  const deduped: Array<ReturnType<typeof relationship>> = []

  for (const item of relationships) {
    const key = `${item.type}:${item.target.kind}:${item.target.nodeId}:${item.target.id}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }

  return deduped
}

const entitySortRank: Record<string, number> = {
  [DOCKER_ENTITY_KINDS.daemon]: 0,
  [DOCKER_ENTITY_KINDS.container]: 1,
  [DOCKER_ENTITY_KINDS.image]: 2,
  [DOCKER_ENTITY_KINDS.volume]: 3,
  [DOCKER_ENTITY_KINDS.network]: 4,
}

const collectMetrics = (
  nodeId: string,
  ts: number,
  daemonRef: EntityRef,
  info: DockerInfo,
  containers: ReadonlyArray<DockerContainerInspect>,
  statsById: ReadonlyMap<string, DockerContainerStats>,
): ReadonlyArray<MetricPoint> => {
  const metrics: MetricPoint[] = [
    {
      pluginId: DOCKER_PLUGIN_ID,
      metricId: DOCKER_METRIC_IDS.runningContainers,
      ts,
      entity: daemonRef,
      value: info.ContainersRunning ?? 0,
      unit: "count",
    },
    {
      pluginId: DOCKER_PLUGIN_ID,
      metricId: DOCKER_METRIC_IDS.pausedContainers,
      ts,
      entity: daemonRef,
      value: info.ContainersPaused ?? 0,
      unit: "count",
    },
    {
      pluginId: DOCKER_PLUGIN_ID,
      metricId: DOCKER_METRIC_IDS.stoppedContainers,
      ts,
      entity: daemonRef,
      value: info.ContainersStopped ?? 0,
      unit: "count",
    },
  ]

  for (const container of containers) {
    const entity = dockerEntityRef(DOCKER_ENTITY_KINDS.container, nodeId, container.Id)
    const stats = statsById.get(container.Id)
    const [networkRxBytes, networkTxBytes] = parseIoPair(stats?.NetIO)

    metrics.push(
      {
        pluginId: DOCKER_PLUGIN_ID,
        metricId: DOCKER_METRIC_IDS.containerCpuPercent,
        ts,
        entity,
        value: parsePercent(stats?.CPUPerc),
        unit: "percent",
      },
      {
        pluginId: DOCKER_PLUGIN_ID,
        metricId: DOCKER_METRIC_IDS.containerMemoryUsageBytes,
        ts,
        entity,
        value: parseIoPair(stats?.MemUsage)[0],
        unit: "bytes",
      },
      {
        pluginId: DOCKER_PLUGIN_ID,
        metricId: DOCKER_METRIC_IDS.containerNetworkRxBytes,
        ts,
        entity,
        value: networkRxBytes,
        unit: "bytes",
      },
      {
        pluginId: DOCKER_PLUGIN_ID,
        metricId: DOCKER_METRIC_IDS.containerNetworkTxBytes,
        ts,
        entity,
        value: networkTxBytes,
        unit: "bytes",
      },
      {
        pluginId: DOCKER_PLUGIN_ID,
        metricId: DOCKER_METRIC_IDS.containerRestarts,
        ts,
        entity,
        value: container.RestartCount ?? 0,
        unit: "count",
      },
      {
        pluginId: DOCKER_PLUGIN_ID,
        metricId: DOCKER_METRIC_IDS.containerUptimeSeconds,
        ts,
        entity,
        value: containerUptimeSeconds(container, ts),
        unit: "seconds",
      },
    )
  }

  return metrics
}

const collectInventory = (
  nodeId: string,
  ts: number,
  info: DockerInfo,
  containers: ReadonlyArray<DockerContainerInspect>,
  images: ReadonlyArray<DockerImageInspect>,
  volumes: ReadonlyArray<DockerVolumeInspect>,
  networks: ReadonlyArray<DockerNetworkInspect>,
  statsById: ReadonlyMap<string, DockerContainerStats>,
): PluginCollectionResult => {
  const daemonId = info.ID?.trim() || "local"
  const daemonRef = dockerEntityRef(DOCKER_ENTITY_KINDS.daemon, nodeId, daemonId)
  const imageRefs = new Set(images.map((image) => image.Id))
  const volumeRefs = new Set(volumes.map((volume) => volume.Name))
  const networkRefs = new Set(networks.map((network) => network.Id))

  const imageUsers = new Map<string, Set<string>>()
  const volumeUsers = new Map<string, Set<string>>()
  const networkUsers = new Map<string, Set<string>>()

  for (const container of containers) {
    if (container.Image !== undefined && imageRefs.has(container.Image)) {
      const users = imageUsers.get(container.Image) ?? new Set<string>()
      users.add(container.Id)
      imageUsers.set(container.Image, users)
    }

    for (const mount of container.Mounts ?? []) {
      if (mount.Type !== "volume" || mount.Name === undefined || !volumeRefs.has(mount.Name)) continue
      const users = volumeUsers.get(mount.Name) ?? new Set<string>()
      users.add(container.Id)
      volumeUsers.set(mount.Name, users)
    }

    for (const network of Object.values(container.NetworkSettings?.Networks ?? {})) {
      if (network.NetworkID === undefined || !networkRefs.has(network.NetworkID)) continue
      const users = networkUsers.get(network.NetworkID) ?? new Set<string>()
      users.add(container.Id)
      networkUsers.set(network.NetworkID, users)
    }
  }

  const entities = [
    {
      ref: daemonRef,
      ts,
      displayName: info.Name?.trim() || "Docker Engine",
      status: daemonStatus(),
      labels: normalizeLabels({
        ...(info.Driver !== undefined && { driver: info.Driver }),
        ...(info.OperatingSystem !== undefined && { operatingSystem: info.OperatingSystem }),
        ...(info.ServerVersion !== undefined && { serverVersion: info.ServerVersion }),
      }),
      spec: definedFields({
        serverVersion: info.ServerVersion,
        operatingSystem: info.OperatingSystem,
        osType: info.OSType,
        architecture: info.Architecture,
        kernelVersion: info.KernelVersion,
        rootDir: info.DockerRootDir,
        storageDriver: info.Driver,
      }),
      state: definedFields({
        cpuCount: info.NCPU,
        memoryBytes: info.MemTotal,
        containers: info.Containers,
        containersRunning: info.ContainersRunning,
        containersPaused: info.ContainersPaused,
        containersStopped: info.ContainersStopped,
        images: info.Images,
      }),
    },
    ...containers.map((container) => ({
      ref: dockerEntityRef(DOCKER_ENTITY_KINDS.container, nodeId, container.Id),
      ts,
      displayName: normalizeContainerName(container.Name, container.Id),
      status: containerStatus(container),
      labels: normalizeLabels(container.Config?.Labels),
      spec: definedFields({
        imageId: container.Image,
        imageName: container.Config?.Image,
        hostname: container.Config?.Hostname,
        networkMode: container.HostConfig?.NetworkMode,
        createdAt: container.Created,
        mounts: (container.Mounts ?? []).map((mount) =>
          definedFields({
            type: mount.Type,
            name: mount.Name,
            source: mount.Source,
            destination: mount.Destination,
            readWrite: mount.RW,
          }),
        ),
      }),
      state: definedFields({
        running: container.State?.Running ?? false,
        paused: container.State?.Paused ?? false,
        restarting: container.State?.Restarting ?? false,
        oomKilled: container.State?.OOMKilled ?? false,
        dead: container.State?.Dead ?? false,
        exitCode: container.State?.ExitCode,
        startedAt: container.State?.StartedAt,
        finishedAt: container.State?.FinishedAt,
        healthStatus: container.State?.Health?.Status,
        networks: Object.entries(container.NetworkSettings?.Networks ?? {}).map(([name, network]) =>
          definedFields({
            name,
            networkId: network.NetworkID,
            ipAddress: network.IPAddress,
            gateway: network.Gateway,
            aliases: network.Aliases ?? [],
          }),
        ),
      }),
      relationships: dedupeRelationships([
        relationship("managed-by", daemonRef),
        ...(container.Image !== undefined && imageRefs.has(container.Image)
          ? [relationship("uses-image", dockerEntityRef(DOCKER_ENTITY_KINDS.image, nodeId, container.Image))]
          : []),
        ...(container.Mounts ?? []).flatMap((mount) =>
          mount.Type === "volume" && mount.Name !== undefined && volumeRefs.has(mount.Name)
            ? [relationship("mounts-volume", dockerEntityRef(DOCKER_ENTITY_KINDS.volume, nodeId, mount.Name))]
            : [],
        ),
        ...Object.values(container.NetworkSettings?.Networks ?? {}).flatMap((network) =>
          network.NetworkID !== undefined && networkRefs.has(network.NetworkID)
            ? [
                relationship(
                  "attached-to-network",
                  dockerEntityRef(DOCKER_ENTITY_KINDS.network, nodeId, network.NetworkID),
                ),
              ]
            : [],
        ),
      ]),
    })),
    ...images.map((image) => ({
      ref: dockerEntityRef(DOCKER_ENTITY_KINDS.image, nodeId, image.Id),
      ts,
      displayName: image.RepoTags?.[0] ?? image.Id,
      status: imageStatus(),
      labels: normalizeLabels(image.Config?.Labels),
      spec: definedFields({
        repoTags: image.RepoTags ?? [],
        repoDigests: image.RepoDigests ?? [],
        createdAt: image.Created,
        parentId: image.Parent,
        architecture: image.Architecture,
        os: image.Os,
      }),
      state: definedFields({
        sizeBytes: image.Size,
        sharedSizeBytes: image.SharedSize,
        virtualSizeBytes: image.VirtualSize,
      }),
      relationships: dedupeRelationships([
        relationship("managed-by", daemonRef),
        ...[...(imageUsers.get(image.Id) ?? new Set<string>())].map((containerId) =>
          relationship(
            "used-by-container",
            dockerEntityRef(DOCKER_ENTITY_KINDS.container, nodeId, containerId),
          ),
        ),
      ]),
    })),
    ...volumes.map((volume) => ({
      ref: dockerEntityRef(DOCKER_ENTITY_KINDS.volume, nodeId, volume.Name),
      ts,
      displayName: volume.Name,
      status: volumeStatus(volume),
      labels: normalizeLabels(volume.Labels),
      spec: definedFields({
        driver: volume.Driver,
        scope: volume.Scope,
        mountpoint: volume.Mountpoint,
        options: volume.Options,
        createdAt: volume.CreatedAt,
      }),
      state: definedFields({
        refCount: volume.UsageData?.RefCount,
        sizeBytes: volume.UsageData?.Size,
      }),
      relationships: dedupeRelationships([
        relationship("managed-by", daemonRef),
        ...[...(volumeUsers.get(volume.Name) ?? new Set<string>())].map((containerId) =>
          relationship(
            "mounted-by-container",
            dockerEntityRef(DOCKER_ENTITY_KINDS.container, nodeId, containerId),
          ),
        ),
      ]),
    })),
    ...networks.map((network) => ({
      ref: dockerEntityRef(DOCKER_ENTITY_KINDS.network, nodeId, network.Id),
      ts,
      displayName: network.Name ?? network.Id,
      status: networkStatus(),
      labels: normalizeLabels(network.Labels),
      spec: definedFields({
        name: network.Name,
        driver: network.Driver,
        scope: network.Scope,
        internal: network.Internal,
        enableIPv6: network.EnableIPv6,
        createdAt: network.Created,
        ipam: network.IPAM,
      }),
      state: definedFields({
        connectedContainers: (networkUsers.get(network.Id) ?? new Set<string>()).size,
      }),
      relationships: dedupeRelationships([
        relationship("managed-by", daemonRef),
        ...[...(networkUsers.get(network.Id) ?? new Set<string>())].map((containerId) =>
          relationship(
            "connected-container",
            dockerEntityRef(DOCKER_ENTITY_KINDS.container, nodeId, containerId),
          ),
        ),
      ]),
    })),
  ]

  entities.sort((left, right) => {
    const rankDelta = (entitySortRank[left.ref.kind] ?? 99) - (entitySortRank[right.ref.kind] ?? 99)
    if (rankDelta !== 0) return rankDelta
    return left.ref.id.localeCompare(right.ref.id)
  })

  return {
    entities,
    metrics: collectMetrics(nodeId, ts, daemonRef, info, containers, statsById),
  }
}

export const createDockerAgentPlugin = (
  overrides: Partial<DockerDependencies> = {},
): ScoutAgentPlugin<PluginExecutionError> => {
  const deps = { ...makeDefaultDependencies(), ...overrides } satisfies DockerDependencies

  const availableCapability = (): PluginCapability => ({
    pluginId: DOCKER_PLUGIN_ID,
    version: manifest.version,
    status: "available",
    features: [...DOCKER_FEATURES],
  })

  const degradedCapability = (reason: string): PluginCapability => ({
    pluginId: DOCKER_PLUGIN_ID,
    version: manifest.version,
    status: "degraded",
    features: [...DOCKER_FEATURES],
    reason,
  })

  const unsupportedCapability = (reason: string): PluginCapability => ({
    pluginId: DOCKER_PLUGIN_ID,
    version: manifest.version,
    status: "unsupported",
    features: [...DOCKER_FEATURES],
    reason,
  })

  const detect = (): Effect.Effect<PluginCapability> =>
    runDocker(deps, ["--version"]).pipe(
      Effect.matchEffect({
        onFailure: (error: Error) =>
          Effect.succeed(
            unsupportedCapability(
              isMissingDockerCommand(error) ? "docker CLI not found on node" : String(error.message || error),
            ),
          ),
        onSuccess: (versionResult) => {
          if (versionResult.exitCode !== 0) {
            return Effect.succeed(
              unsupportedCapability(trimCommandFailure("docker", ["--version"], versionResult)),
            )
          }

          return runDocker(deps, ["info", "--format", "{{json .}}"]).pipe(
            Effect.match({
              onFailure: (error: Error) => degradedCapability(String(error.message || error)),
              onSuccess: (infoResult) =>
                infoResult.exitCode !== 0
                  ? degradedCapability(
                      trimCommandFailure("docker", ["info", "--format", "{{json .}}"], infoResult),
                    )
                  : availableCapability(),
            }),
          )
        },
      }),
    )

  const collect = (ctx: { readonly nodeId: string; readonly now: number }) =>
    getDockerInfo(deps).pipe(
      Effect.flatMap((info) =>
        Effect.all([
          listDockerIds(deps, ["container", "ls", "--all", "--quiet", "--no-trunc"]).pipe(
            Effect.flatMap((ids) => inspectDockerResources<DockerContainerInspect>(deps, "container", ids)),
            Effect.orElseSucceed(() => []),
          ),
          listDockerIds(deps, ["image", "ls", "--quiet", "--no-trunc"]).pipe(
            Effect.flatMap((ids) => inspectDockerResources<DockerImageInspect>(deps, "image", ids)),
            Effect.orElseSucceed(() => []),
          ),
          listDockerIds(deps, ["volume", "ls", "--quiet"]).pipe(
            Effect.flatMap((ids) => inspectDockerResources<DockerVolumeInspect>(deps, "volume", ids)),
            Effect.orElseSucceed(() => []),
          ),
          listDockerIds(deps, ["network", "ls", "--quiet", "--no-trunc"]).pipe(
            Effect.flatMap((ids) => inspectDockerResources<DockerNetworkInspect>(deps, "network", ids)),
            Effect.orElseSucceed(() => []),
          ),
        ]).pipe(
          Effect.flatMap(([containers, images, volumes, networks]) => {
            const runningContainerIds = containers
              .filter((container) => container.State?.Running === true)
              .map((container) => container.Id)

            const statsEffect =
              runningContainerIds.length === 0
                ? Effect.succeed([] as ReadonlyArray<DockerContainerStats>)
                : runDocker(deps, [
                    "container",
                    "stats",
                    "--no-stream",
                    "--format",
                    "{{json .}}",
                    ...runningContainerIds,
                  ]).pipe(
                    Effect.map((result) =>
                      result.exitCode === 0 ? parseDockerStatsLines(result.stdout) : [],
                    ),
                    Effect.orElseSucceed(() => [] as ReadonlyArray<DockerContainerStats>),
                  )

            return statsEffect.pipe(
              Effect.map((stats) =>
                collectInventory(
                  ctx.nodeId,
                  ctx.now,
                  info,
                  containers,
                  images,
                  volumes,
                  networks,
                  new Map(
                    stats.flatMap((entry) => (entry.ID !== undefined ? [[entry.ID, entry] as const] : [])),
                  ),
                ),
              ),
            )
          }),
        ),
      ),
      Effect.orElseSucceed(() => emptyInventory()),
    )

  const inspectContainer = (target: ActionTarget) =>
    getTargetId(target, DOCKER_ENTITY_KINDS.container, {
      actionId: DOCKER_ACTION_IDS.inspectContainer,
    }).pipe(
      Effect.flatMap((containerId) =>
        inspectDockerResources<DockerContainerInspect>(deps, "container", [containerId]).pipe(
          Effect.flatMap((containers) =>
            containers[0] === undefined
              ? Effect.fail(
                  failExecution("not-found", "Container inspect returned no result", {
                    actionId: DOCKER_ACTION_IDS.inspectContainer,
                  }),
                )
              : Effect.succeed({ payload: containers[0] }),
          ),
          Effect.mapError((error) =>
            error instanceof PluginExecutionError
              ? error
              : failExecution("inspect-failed", String(error), {
                  actionId: DOCKER_ACTION_IDS.inspectContainer,
                }),
          ),
        ),
      ),
    )

  const runContainerAction = (
    verb: "start" | "stop" | "restart" | "rm",
    actionId: string,
    target: ActionTarget,
  ) =>
    getTargetId(target, DOCKER_ENTITY_KINDS.container, { actionId }).pipe(
      Effect.flatMap((containerId) =>
        runChecked(deps, ["container", verb, containerId], { actionId }).pipe(
          Effect.map((stdout) => ({ stdout: stdout.trim() })),
        ),
      ),
    )

  const pullImage = (target: ActionTarget) =>
    getTargetId(target, DOCKER_ENTITY_KINDS.image, {
      actionId: DOCKER_ACTION_IDS.pullImage,
    }).pipe(
      Effect.flatMap((imageId) =>
        runChecked(deps, ["image", "pull", imageId], {
          actionId: DOCKER_ACTION_IDS.pullImage,
        }).pipe(Effect.map((stdout) => ({ stdout: stdout.trim() }))),
      ),
    )

  const pruneSystem = (target: ActionTarget) =>
    getTargetId(target, DOCKER_ENTITY_KINDS.daemon, {
      actionId: DOCKER_ACTION_IDS.pruneSystem,
    }).pipe(
      Effect.flatMap(() =>
        runChecked(deps, ["system", "prune", "--force"], {
          actionId: DOCKER_ACTION_IDS.pruneSystem,
        }).pipe(Effect.map((stdout) => ({ stdout: stdout.trim() }))),
      ),
    )

  const actions: ReadonlyArray<ScoutActionHandler<unknown, unknown, PluginExecutionError>> = [
    {
      definition: manifest.actions.find((action) => action.id === DOCKER_ACTION_IDS.inspectContainer)!,
      inputSchema: EmptyInputSchema,
      outputSchema: InspectOutputSchema,
      execute: (_ctx, target: ActionTarget, _input: unknown) => inspectContainer(target),
    },
    {
      definition: manifest.actions.find((action) => action.id === DOCKER_ACTION_IDS.startContainer)!,
      inputSchema: EmptyInputSchema,
      outputSchema: CommandOutputSchema,
      execute: (_ctx, target: ActionTarget, _input: unknown) =>
        runContainerAction("start", DOCKER_ACTION_IDS.startContainer, target),
    },
    {
      definition: manifest.actions.find((action) => action.id === DOCKER_ACTION_IDS.stopContainer)!,
      inputSchema: EmptyInputSchema,
      outputSchema: CommandOutputSchema,
      execute: (_ctx, target: ActionTarget, _input: unknown) =>
        runContainerAction("stop", DOCKER_ACTION_IDS.stopContainer, target),
    },
    {
      definition: manifest.actions.find((action) => action.id === DOCKER_ACTION_IDS.restartContainer)!,
      inputSchema: EmptyInputSchema,
      outputSchema: CommandOutputSchema,
      execute: (_ctx, target: ActionTarget, _input: unknown) =>
        runContainerAction("restart", DOCKER_ACTION_IDS.restartContainer, target),
    },
    {
      definition: manifest.actions.find((action) => action.id === DOCKER_ACTION_IDS.removeContainer)!,
      inputSchema: EmptyInputSchema,
      outputSchema: CommandOutputSchema,
      execute: (_ctx, target: ActionTarget, _input: unknown) =>
        runContainerAction("rm", DOCKER_ACTION_IDS.removeContainer, target),
    },
    {
      definition: manifest.actions.find((action) => action.id === DOCKER_ACTION_IDS.pullImage)!,
      inputSchema: EmptyInputSchema,
      outputSchema: CommandOutputSchema,
      execute: (_ctx, target: ActionTarget, _input: unknown) => pullImage(target),
    },
    {
      definition: manifest.actions.find((action) => action.id === DOCKER_ACTION_IDS.pruneSystem)!,
      inputSchema: EmptyInputSchema,
      outputSchema: CommandOutputSchema,
      execute: (_ctx, target: ActionTarget, _input: unknown) => pruneSystem(target),
    },
  ]

  const streams: ReadonlyArray<ScoutStreamHandler<unknown, LogChunk, PluginExecutionError>> = [
    {
      definition: manifest.streams.find((stream) => stream.id === DOCKER_STREAM_IDS.containerLogs)!,
      inputSchema: ContainerLogsInputSchema,
      chunkSchema: LogChunkSchema,
      open: (_ctx, target: ActionTarget, input: unknown) =>
        Stream.unwrap(
          getTargetId(target, DOCKER_ENTITY_KINDS.container, {
            streamId: DOCKER_STREAM_IDS.containerLogs,
          }).pipe(
            Effect.map((containerId) =>
              deps.followLogs(containerId, (input as { tail?: number }).tail ?? 200).pipe(
                Stream.mapError((error) =>
                  error instanceof PluginExecutionError
                    ? error
                    : failExecution("stream-failed", String(error), {
                        streamId: DOCKER_STREAM_IDS.containerLogs,
                      }),
                ),
              ),
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

export const docker = createDockerAgentPlugin()
