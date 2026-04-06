import { Schema } from "effect"
import type {
  ActionDefinition,
  EntityKindDefinition,
  MetricDefinition,
  StreamDefinition,
  ViewDefinition,
} from "@scout/plugin-sdk"

export const K8S_PLUGIN_ID = "@scout/plugin-k8s"
export const K8S_CAPABILITY_ID = "kubernetes"

export const K8S_ENTITY_KINDS = {
  cluster: "k8s.cluster",
  namespace: "k8s.namespace",
  node: "k8s.node",
  workload: "k8s.workload",
  pod: "k8s.pod",
  deployment: "k8s.deployment",
  statefulset: "k8s.statefulset",
  daemonset: "k8s.daemonset",
  service: "k8s.service",
  ingress: "k8s.ingress",
  job: "k8s.job",
  cronjob: "k8s.cronjob",
} as const satisfies Record<string, string>

export const K8S_METRIC_IDS = {
  clusterNodesReady: "cluster.nodes.ready",
  namespaceWorkloadsReady: "namespace.workloads.ready",
  workloadReplicasReady: "workload.replicas.ready",
  podRestartsTotal: "pod.restarts.total",
  podReady: "pod.ready",
  nodeReady: "node.condition.ready",
} as const satisfies Record<string, string>

export const K8S_ACTION_IDS = {
  describeResource: "describe-resource",
  scaleWorkload: "scale-workload",
  restartPod: "restart-pod",
  deletePod: "delete-pod",
} as const satisfies Record<string, string>

export const K8S_STREAM_IDS = {
  podLogs: "pod-logs",
} as const satisfies Record<string, string>

export const EmptyInputSchema = Schema.Struct({})

export const TextOutputSchema = Schema.Struct({
  text: Schema.String,
})

export const ScaleWorkloadInputSchema = Schema.Struct({
  replicas: Schema.Number,
})

export const PodLogsInputSchema = Schema.Struct({
  tail: Schema.optionalKey(Schema.Number),
  container: Schema.optionalKey(Schema.String),
})

export const K8S_CAPABILITIES: ReadonlyArray<{ id: string; displayName: string; description: string }> = [
  {
    id: K8S_CAPABILITY_ID,
    displayName: "Kubernetes",
    description: "Discover, inspect, and eventually manage Kubernetes clusters and workloads.",
  },
]

export const K8S_ENTITY_KIND_DEFINITIONS: ReadonlyArray<EntityKindDefinition> = [
  {
    id: K8S_ENTITY_KINDS.cluster,
    displayName: "Kubernetes Cluster",
    pluralDisplayName: "Kubernetes Clusters",
    description: "A connected Kubernetes cluster.",
  },
  {
    id: K8S_ENTITY_KINDS.namespace,
    displayName: "Namespace",
    pluralDisplayName: "Namespaces",
    description: "A Kubernetes namespace.",
  },
  {
    id: K8S_ENTITY_KINDS.node,
    displayName: "Node",
    pluralDisplayName: "Nodes",
    description: "A Kubernetes node.",
  },
  {
    id: K8S_ENTITY_KINDS.workload,
    displayName: "Workload",
    pluralDisplayName: "Workloads",
    description: "An abstract workload grouping for pods and controllers.",
  },
  {
    id: K8S_ENTITY_KINDS.pod,
    displayName: "Pod",
    pluralDisplayName: "Pods",
    description: "A Kubernetes pod.",
  },
  {
    id: K8S_ENTITY_KINDS.deployment,
    displayName: "Deployment",
    pluralDisplayName: "Deployments",
    description: "A Kubernetes deployment.",
  },
  {
    id: K8S_ENTITY_KINDS.statefulset,
    displayName: "StatefulSet",
    pluralDisplayName: "StatefulSets",
    description: "A Kubernetes StatefulSet.",
  },
  {
    id: K8S_ENTITY_KINDS.daemonset,
    displayName: "DaemonSet",
    pluralDisplayName: "DaemonSets",
    description: "A Kubernetes DaemonSet.",
  },
  {
    id: K8S_ENTITY_KINDS.service,
    displayName: "Service",
    pluralDisplayName: "Services",
    description: "A Kubernetes service.",
  },
  {
    id: K8S_ENTITY_KINDS.ingress,
    displayName: "Ingress",
    pluralDisplayName: "Ingresses",
    description: "A Kubernetes ingress.",
  },
  {
    id: K8S_ENTITY_KINDS.job,
    displayName: "Job",
    pluralDisplayName: "Jobs",
    description: "A Kubernetes job.",
  },
  {
    id: K8S_ENTITY_KINDS.cronjob,
    displayName: "CronJob",
    pluralDisplayName: "CronJobs",
    description: "A Kubernetes CronJob.",
  },
]

export const K8S_METRIC_DEFINITIONS: ReadonlyArray<MetricDefinition> = [
  {
    id: K8S_METRIC_IDS.clusterNodesReady,
    displayName: "Cluster Nodes Ready",
    kind: "gauge",
    unit: "count",
  },
  {
    id: K8S_METRIC_IDS.namespaceWorkloadsReady,
    displayName: "Namespace Workloads Ready",
    kind: "gauge",
    entityKinds: [K8S_ENTITY_KINDS.namespace],
    unit: "count",
  },
  {
    id: K8S_METRIC_IDS.workloadReplicasReady,
    displayName: "Workload Replicas Ready",
    kind: "gauge",
    entityKinds: [K8S_ENTITY_KINDS.deployment],
    unit: "count",
  },
  {
    id: K8S_METRIC_IDS.podRestartsTotal,
    displayName: "Pod Restarts",
    kind: "counter",
    entityKinds: [K8S_ENTITY_KINDS.pod],
    unit: "count",
  },
  {
    id: K8S_METRIC_IDS.podReady,
    displayName: "Pod Ready",
    kind: "state",
    entityKinds: [K8S_ENTITY_KINDS.pod],
  },
  {
    id: K8S_METRIC_IDS.nodeReady,
    displayName: "Node Ready",
    kind: "state",
    entityKinds: [K8S_ENTITY_KINDS.node],
  },
]

export const K8S_ACTION_DEFINITIONS: ReadonlyArray<ActionDefinition> = [
  {
    id: K8S_ACTION_IDS.describeResource,
    displayName: "Describe Resource",
    targetKinds: [
      K8S_ENTITY_KINDS.cluster,
      K8S_ENTITY_KINDS.namespace,
      K8S_ENTITY_KINDS.node,
      K8S_ENTITY_KINDS.workload,
      K8S_ENTITY_KINDS.pod,
      K8S_ENTITY_KINDS.deployment,
      K8S_ENTITY_KINDS.statefulset,
      K8S_ENTITY_KINDS.daemonset,
      K8S_ENTITY_KINDS.service,
      K8S_ENTITY_KINDS.ingress,
      K8S_ENTITY_KINDS.job,
      K8S_ENTITY_KINDS.cronjob,
    ],
    permissions: ["node:k8s-api"],
    requiresConfirmation: false,
  },
  {
    id: K8S_ACTION_IDS.scaleWorkload,
    displayName: "Scale Workload",
    targetKinds: [
      K8S_ENTITY_KINDS.workload,
      K8S_ENTITY_KINDS.deployment,
      K8S_ENTITY_KINDS.statefulset,
      K8S_ENTITY_KINDS.daemonset,
      K8S_ENTITY_KINDS.job,
      K8S_ENTITY_KINDS.cronjob,
    ],
    permissions: ["node:k8s-api"],
    requiresConfirmation: true,
  },
  {
    id: K8S_ACTION_IDS.restartPod,
    displayName: "Restart Pod",
    targetKinds: [K8S_ENTITY_KINDS.pod],
    permissions: ["node:k8s-api", "node:spawn-process"],
    requiresConfirmation: true,
  },
  {
    id: K8S_ACTION_IDS.deletePod,
    displayName: "Delete Pod",
    targetKinds: [K8S_ENTITY_KINDS.pod],
    permissions: ["node:k8s-api"],
    requiresConfirmation: true,
  },
]

export const K8S_STREAM_DEFINITIONS: ReadonlyArray<StreamDefinition> = [
  {
    id: K8S_STREAM_IDS.podLogs,
    displayName: "Pod Logs",
    kind: "logs",
    targetKinds: [K8S_ENTITY_KINDS.pod],
    permissions: ["node:k8s-api", "node:stream-logs"],
  },
]

export const K8S_VIEW_DEFINITIONS: ReadonlyArray<ViewDefinition> = [
  {
    id: "k8s.cluster-overview",
    pluginId: K8S_PLUGIN_ID,
    kind: "dashboard",
    title: "Kubernetes Overview",
    sections: [
      {
        _tag: "stat-grid",
        title: "Cluster Health",
        metrics: [
          {
            metricId: K8S_METRIC_IDS.clusterNodesReady,
            label: "Nodes Ready",
            unit: "count",
          },
        ],
      },
      {
        _tag: "entity-table",
        title: "Namespaces",
        entityKind: K8S_ENTITY_KINDS.namespace,
        columns: [
          {
            id: "name",
            label: "Name",
            source: { _tag: "field", path: "displayName" },
          },
          {
            id: "status",
            label: "Status",
            source: { _tag: "status" },
          },
        ],
      },
    ],
  },
  {
    id: "k8s.namespace-detail",
    pluginId: K8S_PLUGIN_ID,
    kind: "detail",
    title: "Namespace Detail",
    entityKind: K8S_ENTITY_KINDS.namespace,
    sections: [
      {
        _tag: "timeseries",
        title: "Workload Readiness",
        metrics: [
          {
            metricId: K8S_METRIC_IDS.namespaceWorkloadsReady,
            label: "Workloads Ready",
            unit: "count",
          },
        ],
      },
      {
        _tag: "actions",
        title: "Namespace Actions",
        actions: [
          {
            actionId: K8S_ACTION_IDS.describeResource,
            label: "Describe",
          },
        ],
      },
    ],
  },
  {
    id: "k8s.workload-detail",
    pluginId: K8S_PLUGIN_ID,
    kind: "detail",
    title: "Workload Detail",
    entityKind: K8S_ENTITY_KINDS.workload,
    sections: [
      {
        _tag: "stat-grid",
        title: "Workload Stats",
        metrics: [
          {
            metricId: K8S_METRIC_IDS.workloadReplicasReady,
            label: "Replicas Ready",
            unit: "count",
          },
        ],
      },
      {
        _tag: "logs",
        title: "Pod Logs",
        streamId: K8S_STREAM_IDS.podLogs,
      },
    ],
  },
  {
    id: "k8s.pod-detail",
    pluginId: K8S_PLUGIN_ID,
    kind: "detail",
    title: "Pod Detail",
    entityKind: K8S_ENTITY_KINDS.pod,
    sections: [
      {
        _tag: "detail",
        title: "Pod Fields",
        fields: [
          {
            id: "name",
            label: "Name",
            source: { _tag: "field", path: "displayName" },
          },
          {
            id: "status",
            label: "Status",
            source: { _tag: "status" },
          },
        ],
      },
      {
        _tag: "actions",
        title: "Pod Actions",
        actions: [
          {
            actionId: K8S_ACTION_IDS.restartPod,
            label: "Restart",
          },
        ],
      },
    ],
  },
]
