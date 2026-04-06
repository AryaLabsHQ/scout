import { Schema } from "effect"
import type {
  ActionDefinition,
  EntityKindDefinition,
  MetricDefinition,
  StreamDefinition,
  ViewDefinition,
} from "@scout/plugin-sdk"

export const DOCKER_PLUGIN_ID = "@scout/plugin-docker"
export const DOCKER_CAPABILITY_ID = "docker"
export const DOCKER_FEATURES = [
  "inventory",
  "relationships",
  "metrics",
  "actions",
  "logs",
] as const

export const DOCKER_ENTITY_KINDS = {
  daemon: "docker.daemon",
  container: "docker.container",
  image: "docker.image",
  volume: "docker.volume",
  network: "docker.network",
} as const satisfies Record<string, string>

export const DOCKER_METRIC_IDS = {
  runningContainers: "containers.running",
  pausedContainers: "containers.paused",
  stoppedContainers: "containers.stopped",
  containerCpuPercent: "container.cpu.percent",
  containerMemoryUsageBytes: "container.memory.usage.bytes",
  containerNetworkRxBytes: "container.network.rx.bytes",
  containerNetworkTxBytes: "container.network.tx.bytes",
  containerRestarts: "container.restarts",
  containerUptimeSeconds: "container.uptime.seconds",
} as const satisfies Record<string, string>

export const DOCKER_ACTION_IDS = {
  inspectContainer: "container.inspect",
  startContainer: "container.start",
  stopContainer: "container.stop",
  restartContainer: "container.restart",
  removeContainer: "container.remove",
  pullImage: "image.pull",
  pruneSystem: "system.prune",
} as const satisfies Record<string, string>

export const DOCKER_STREAM_IDS = {
  containerLogs: "container.logs",
} as const satisfies Record<string, string>

export const EmptyInputSchema = Schema.Struct({})

export const InspectOutputSchema = Schema.Struct({
  payload: Schema.Unknown,
})

export const CommandOutputSchema = Schema.Struct({
  stdout: Schema.String,
})

export const ContainerLogsInputSchema = Schema.Struct({
  tail: Schema.optionalKey(Schema.Number),
})

export const DOCKER_CAPABILITIES: ReadonlyArray<{ id: string; displayName: string; description: string }> = [
  {
    id: DOCKER_CAPABILITY_ID,
    displayName: "Docker",
    description: "Inspect and eventually manage Docker containers, images, volumes, and networks.",
  },
]

export const DOCKER_ENTITY_KIND_DEFINITIONS: ReadonlyArray<EntityKindDefinition> = [
  {
    id: DOCKER_ENTITY_KINDS.daemon,
    displayName: "Docker Daemon",
    pluralDisplayName: "Docker Daemons",
    description: "A Docker daemon running on a Scout-managed node.",
  },
  {
    id: DOCKER_ENTITY_KINDS.container,
    displayName: "Container",
    pluralDisplayName: "Containers",
    description: "A Docker container.",
  },
  {
    id: DOCKER_ENTITY_KINDS.image,
    displayName: "Image",
    pluralDisplayName: "Images",
    description: "A Docker image.",
  },
  {
    id: DOCKER_ENTITY_KINDS.volume,
    displayName: "Volume",
    pluralDisplayName: "Volumes",
    description: "A Docker volume.",
  },
  {
    id: DOCKER_ENTITY_KINDS.network,
    displayName: "Network",
    pluralDisplayName: "Networks",
    description: "A Docker network.",
  },
]

export const DOCKER_METRIC_DEFINITIONS: ReadonlyArray<MetricDefinition> = [
  {
    id: DOCKER_METRIC_IDS.runningContainers,
    displayName: "Running Containers",
    kind: "gauge",
    unit: "count",
  },
  {
    id: DOCKER_METRIC_IDS.pausedContainers,
    displayName: "Paused Containers",
    kind: "gauge",
    unit: "count",
  },
  {
    id: DOCKER_METRIC_IDS.stoppedContainers,
    displayName: "Stopped Containers",
    kind: "gauge",
    unit: "count",
  },
  {
    id: DOCKER_METRIC_IDS.containerCpuPercent,
    displayName: "Container CPU",
    kind: "gauge",
    entityKinds: [DOCKER_ENTITY_KINDS.container],
    unit: "percent",
  },
  {
    id: DOCKER_METRIC_IDS.containerMemoryUsageBytes,
    displayName: "Container Memory Usage",
    kind: "gauge",
    entityKinds: [DOCKER_ENTITY_KINDS.container],
    unit: "bytes",
  },
  {
    id: DOCKER_METRIC_IDS.containerNetworkRxBytes,
    displayName: "Container Network RX",
    kind: "counter",
    entityKinds: [DOCKER_ENTITY_KINDS.container],
    unit: "bytes",
  },
  {
    id: DOCKER_METRIC_IDS.containerNetworkTxBytes,
    displayName: "Container Network TX",
    kind: "counter",
    entityKinds: [DOCKER_ENTITY_KINDS.container],
    unit: "bytes",
  },
  {
    id: DOCKER_METRIC_IDS.containerRestarts,
    displayName: "Container Restarts",
    kind: "counter",
    entityKinds: [DOCKER_ENTITY_KINDS.container],
    unit: "count",
  },
  {
    id: DOCKER_METRIC_IDS.containerUptimeSeconds,
    displayName: "Container Uptime",
    kind: "gauge",
    entityKinds: [DOCKER_ENTITY_KINDS.container],
    unit: "seconds",
  },
]

export const DOCKER_ACTION_DEFINITIONS: ReadonlyArray<ActionDefinition> = [
  {
    id: DOCKER_ACTION_IDS.inspectContainer,
    displayName: "Inspect Container",
    targetKinds: [DOCKER_ENTITY_KINDS.container],
    permissions: ["node:docker-socket"],
    requiresConfirmation: false,
  },
  {
    id: DOCKER_ACTION_IDS.startContainer,
    displayName: "Start Container",
    targetKinds: [DOCKER_ENTITY_KINDS.container],
    permissions: ["node:docker-socket"],
    requiresConfirmation: false,
  },
  {
    id: DOCKER_ACTION_IDS.stopContainer,
    displayName: "Stop Container",
    targetKinds: [DOCKER_ENTITY_KINDS.container],
    permissions: ["node:docker-socket"],
    requiresConfirmation: true,
  },
  {
    id: DOCKER_ACTION_IDS.restartContainer,
    displayName: "Restart Container",
    targetKinds: [DOCKER_ENTITY_KINDS.container],
    permissions: ["node:docker-socket"],
    requiresConfirmation: true,
  },
  {
    id: DOCKER_ACTION_IDS.removeContainer,
    displayName: "Remove Container",
    targetKinds: [DOCKER_ENTITY_KINDS.container],
    permissions: ["node:docker-socket"],
    requiresConfirmation: true,
  },
  {
    id: DOCKER_ACTION_IDS.pullImage,
    displayName: "Pull Image",
    targetKinds: [DOCKER_ENTITY_KINDS.image],
    permissions: ["node:docker-socket", "node:network-egress"],
    requiresConfirmation: false,
  },
  {
    id: DOCKER_ACTION_IDS.pruneSystem,
    displayName: "Prune Docker Resources",
    targetKinds: [DOCKER_ENTITY_KINDS.daemon],
    permissions: ["node:docker-socket"],
    requiresConfirmation: true,
  },
]

export const DOCKER_STREAM_DEFINITIONS: ReadonlyArray<StreamDefinition> = [
  {
    id: DOCKER_STREAM_IDS.containerLogs,
    displayName: "Container Logs",
    kind: "logs",
    targetKinds: [DOCKER_ENTITY_KINDS.container],
    permissions: ["node:docker-socket", "node:stream-logs"],
  },
]

export const DOCKER_VIEW_DEFINITIONS: ReadonlyArray<ViewDefinition> = [
  {
    id: "docker.overview",
    pluginId: DOCKER_PLUGIN_ID,
    kind: "dashboard",
    title: "Docker Overview",
    sections: [
      {
        _tag: "stat-grid",
        title: "Container Health",
        metrics: [
          { metricId: DOCKER_METRIC_IDS.runningContainers, label: "Running", unit: "count" },
          { metricId: DOCKER_METRIC_IDS.pausedContainers, label: "Paused", unit: "count" },
          { metricId: DOCKER_METRIC_IDS.stoppedContainers, label: "Stopped", unit: "count" },
        ],
      },
      {
        _tag: "entity-table",
        title: "Containers",
        entityKind: DOCKER_ENTITY_KINDS.container,
        columns: [
          { id: "name", label: "Name", source: { _tag: "field", path: "displayName" } },
          { id: "status", label: "Status", source: { _tag: "status" } },
          { id: "image", label: "Image", source: { _tag: "field", path: "state.image" } },
        ],
        actions: [
          { actionId: DOCKER_ACTION_IDS.startContainer, label: "Start" },
          { actionId: DOCKER_ACTION_IDS.stopContainer, label: "Stop" },
          { actionId: DOCKER_ACTION_IDS.restartContainer, label: "Restart" },
        ],
      },
    ],
  },
  {
    id: "docker.containers",
    pluginId: DOCKER_PLUGIN_ID,
    kind: "list",
    title: "Docker Containers",
    entityKind: DOCKER_ENTITY_KINDS.container,
    sections: [
      {
        _tag: "entity-table",
        title: "Containers",
        entityKind: DOCKER_ENTITY_KINDS.container,
        columns: [
          { id: "name", label: "Name", source: { _tag: "field", path: "displayName" } },
          { id: "status", label: "Status", source: { _tag: "status" } },
          { id: "restarts", label: "Restarts", source: { _tag: "metric", metricId: DOCKER_METRIC_IDS.containerRestarts } },
        ],
      },
    ],
  },
  {
    id: "docker.container-detail",
    pluginId: DOCKER_PLUGIN_ID,
    kind: "detail",
    title: "Container Detail",
    entityKind: DOCKER_ENTITY_KINDS.container,
    sections: [
      {
        _tag: "detail",
        title: "Container Fields",
        fields: [
          { id: "name", label: "Name", source: { _tag: "field", path: "displayName" } },
          { id: "status", label: "Status", source: { _tag: "status" } },
          { id: "image", label: "Image", source: { _tag: "field", path: "state.image" } },
        ],
      },
      {
        _tag: "timeseries",
        title: "Runtime Metrics",
        metrics: [
          { metricId: DOCKER_METRIC_IDS.containerCpuPercent, label: "CPU", unit: "percent" },
          { metricId: DOCKER_METRIC_IDS.containerMemoryUsageBytes, label: "Memory", unit: "bytes" },
          { metricId: DOCKER_METRIC_IDS.containerNetworkRxBytes, label: "RX", unit: "bytes" },
          { metricId: DOCKER_METRIC_IDS.containerNetworkTxBytes, label: "TX", unit: "bytes" },
        ],
      },
      {
        _tag: "actions",
        title: "Container Actions",
        actions: [
          { actionId: DOCKER_ACTION_IDS.inspectContainer, label: "Inspect" },
          { actionId: DOCKER_ACTION_IDS.startContainer, label: "Start" },
          { actionId: DOCKER_ACTION_IDS.stopContainer, label: "Stop" },
          { actionId: DOCKER_ACTION_IDS.restartContainer, label: "Restart" },
        ],
      },
      {
        _tag: "logs",
        title: "Container Logs",
        streamId: DOCKER_STREAM_IDS.containerLogs,
      },
    ],
  },
  {
    id: "docker.image-detail",
    pluginId: DOCKER_PLUGIN_ID,
    kind: "detail",
    title: "Image Detail",
    entityKind: DOCKER_ENTITY_KINDS.image,
    sections: [
      {
        _tag: "detail",
        title: "Image Fields",
        fields: [
          { id: "name", label: "Image", source: { _tag: "field", path: "displayName" } },
          { id: "digest", label: "Digest", source: { _tag: "field", path: "state.digest" } },
        ],
      },
      {
        _tag: "actions",
        title: "Image Actions",
        actions: [
          { actionId: DOCKER_ACTION_IDS.pullImage, label: "Pull" },
        ],
      },
    ],
  },
]
