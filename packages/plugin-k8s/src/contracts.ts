import { Schema } from "effect"
import type {
  ActionDefinition,
  EntityKindDefinition,
  MetricDefinition,
  PluginUiScreen,
  StreamDefinition,
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

export const K8S_UI_SCREENS: ReadonlyArray<PluginUiScreen> = [
  {
    id: "k8s.cluster-overview",
    pluginId: K8S_PLUGIN_ID,
    kind: "overview",
    title: "Kubernetes Overview",
    spec: {
      root: "page",
      elements: {
        page: {
          type: "Page",
          props: {
            title: "Kubernetes Overview",
            description: "Cluster health, namespaces, and workload inventory.",
          },
          children: ["cluster-health", "namespace-table", "workload-table"],
        },
        "cluster-health": {
          type: "Section",
          props: {
            title: "Cluster Health",
          },
          children: ["nodes-ready-card"],
        },
        "nodes-ready-card": {
          type: "MetricStatCard",
          props: {
            label: "Nodes Ready",
            metricId: K8S_METRIC_IDS.clusterNodesReady,
            unit: "count",
            latestStatePath: `/metricsLatest/${K8S_METRIC_IDS.clusterNodesReady}`,
          },
        },
        "namespace-table": {
          type: "EntityTable",
          props: {
            title: "Namespaces",
            entityKind: K8S_ENTITY_KINDS.namespace,
            statePath: `/entitiesByKind/${K8S_ENTITY_KINDS.namespace}`,
            detailScreenId: "k8s.namespace-detail",
            columns: [
              {
                id: "name",
                label: "Name",
                source: { type: "field", path: "displayName" },
              },
              {
                id: "status",
                label: "Status",
                source: { type: "status" },
              },
              {
                id: "workloads-ready",
                label: "Workloads Ready",
                source: {
                  type: "metric",
                  metricId: K8S_METRIC_IDS.namespaceWorkloadsReady,
                },
              },
            ],
          },
        },
        "workload-table": {
          type: "EntityTable",
          props: {
            title: "Workloads",
            entityKind: K8S_ENTITY_KINDS.deployment,
            statePath: `/entitiesByKind/${K8S_ENTITY_KINDS.deployment}`,
            detailScreenId: "k8s.workload-detail",
            columns: [
              {
                id: "name",
                label: "Workload",
                source: { type: "field", path: "displayName" },
              },
              {
                id: "status",
                label: "Status",
                source: { type: "status" },
              },
              {
                id: "replicas-ready",
                label: "Replicas Ready",
                source: {
                  type: "metric",
                  metricId: K8S_METRIC_IDS.workloadReplicasReady,
                },
              },
            ],
          },
        },
      },
    },
  },
  {
    id: "k8s.namespace-detail",
    pluginId: K8S_PLUGIN_ID,
    kind: "entity-detail",
    title: "Namespace Detail",
    entityKind: K8S_ENTITY_KINDS.namespace,
    spec: {
      root: "page",
      elements: {
        page: {
          type: "Page",
          props: {
            title: "Namespace Detail",
            entityStatePath: "/selectedEntity",
          },
          children: ["namespace-fields", "workload-readiness", "namespace-actions"],
        },
        "namespace-fields": {
          type: "DetailList",
          props: {
            title: "Namespace",
            entityStatePath: "/selectedEntity",
            fields: [
              {
                id: "name",
                label: "Name",
                source: { type: "field", path: "displayName" },
              },
              {
                id: "status",
                label: "Status",
                source: { type: "status" },
              },
            ],
          },
        },
        "workload-readiness": {
          type: "MetricChart",
          props: {
            title: "Workload Readiness",
            metricId: K8S_METRIC_IDS.namespaceWorkloadsReady,
            unit: "count",
            entityStatePath: "/selectedEntity",
            historyStatePath: `/metricsHistory/${K8S_METRIC_IDS.namespaceWorkloadsReady}`,
          },
        },
        "namespace-actions": {
          type: "Section",
          props: {
            title: "Namespace Actions",
          },
          children: ["describe-resource"],
        },
        "describe-resource": {
          type: "ActionButton",
          props: {
            label: "Describe",
            variant: "secondary",
          },
          on: {
            press: {
              action: "plugin.runAction",
              params: {
                pluginId: K8S_PLUGIN_ID,
                actionId: K8S_ACTION_IDS.describeResource,
                target: {
                  entityRef: {
                    $state: "/selectedEntity/ref",
                  },
                },
                input: {},
              },
            },
          },
        },
      },
    },
  },
  {
    id: "k8s.workload-detail",
    pluginId: K8S_PLUGIN_ID,
    kind: "entity-detail",
    title: "Workload Detail",
    entityKind: K8S_ENTITY_KINDS.deployment,
    spec: {
      root: "page",
      state: {
        forms: {
          scaleWorkload: {
            replicas: 1,
          },
        },
      },
      elements: {
        page: {
          type: "Page",
          props: {
            title: "Workload Detail",
            entityStatePath: "/selectedEntity",
          },
          children: [
            "workload-fields",
            "workload-replicas",
            "scale-form",
            "workload-actions",
            "workload-logs",
          ],
        },
        "workload-fields": {
          type: "DetailList",
          props: {
            title: "Workload",
            entityStatePath: "/selectedEntity",
            fields: [
              {
                id: "name",
                label: "Name",
                source: { type: "field", path: "displayName" },
              },
              {
                id: "status",
                label: "Status",
                source: { type: "status" },
              },
            ],
          },
        },
        "workload-replicas": {
          type: "MetricStatCard",
          props: {
            label: "Replicas Ready",
            metricId: K8S_METRIC_IDS.workloadReplicasReady,
            unit: "count",
            entityStatePath: "/selectedEntity",
            latestStatePath: `/metricsLatest/${K8S_METRIC_IDS.workloadReplicasReady}`,
          },
        },
        "scale-form": {
          type: "Form",
          props: {
            title: "Scale Workload",
          },
          children: ["scale-replicas-input", "scale-submit-button"],
        },
        "scale-replicas-input": {
          type: "NumberField",
          props: {
            label: "Replicas",
            min: 0,
            bindState: "/forms/scaleWorkload/replicas",
          },
        },
        "scale-submit-button": {
          type: "ActionButton",
          props: {
            label: "Apply Scale",
          },
          on: {
            press: {
              action: "plugin.runAction",
              confirm: {
                title: "Scale workload",
                message: "Apply the requested replica count to this workload?",
                confirmLabel: "Scale",
              },
              params: {
                pluginId: K8S_PLUGIN_ID,
                actionId: K8S_ACTION_IDS.scaleWorkload,
                target: {
                  entityRef: {
                    $state: "/selectedEntity/ref",
                  },
                },
                input: {
                  replicas: {
                    $state: "/forms/scaleWorkload/replicas",
                  },
                },
              },
            },
          },
        },
        "workload-actions": {
          type: "Section",
          props: {
            title: "Actions",
          },
          children: ["workload-describe-button"],
        },
        "workload-describe-button": {
          type: "ActionButton",
          props: {
            label: "Describe",
            variant: "secondary",
          },
          on: {
            press: {
              action: "plugin.runAction",
              params: {
                pluginId: K8S_PLUGIN_ID,
                actionId: K8S_ACTION_IDS.describeResource,
                target: {
                  entityRef: {
                    $state: "/selectedEntity/ref",
                  },
                },
                input: {},
              },
            },
          },
        },
        "workload-logs": {
          type: "LogPanel",
          props: {
            title: "Pod Logs",
            streamId: K8S_STREAM_IDS.podLogs,
            targetEntityStatePath: "/selectedEntity",
            fallbackTargetKinds: [K8S_ENTITY_KINDS.pod],
            relationshipTypes: ["contains", "owns", "selects", "targets"],
          },
        },
      },
    },
  },
  {
    id: "k8s.pod-detail",
    pluginId: K8S_PLUGIN_ID,
    kind: "entity-detail",
    title: "Pod Detail",
    entityKind: K8S_ENTITY_KINDS.pod,
    spec: {
      root: "page",
      elements: {
        page: {
          type: "Page",
          props: {
            title: "Pod Detail",
            entityStatePath: "/selectedEntity",
          },
          children: ["pod-fields", "pod-stats", "pod-logs", "pod-actions"],
        },
        "pod-fields": {
          type: "DetailList",
          props: {
            title: "Pod Fields",
            entityStatePath: "/selectedEntity",
            fields: [
              {
                id: "name",
                label: "Name",
                source: { type: "field", path: "displayName" },
              },
              {
                id: "status",
                label: "Status",
                source: { type: "status" },
              },
            ],
          },
        },
        "pod-stats": {
          type: "Section",
          props: {
            title: "Pod Health",
          },
          children: ["pod-ready-card", "pod-restarts-card"],
        },
        "pod-ready-card": {
          type: "MetricStatCard",
          props: {
            label: "Ready",
            metricId: K8S_METRIC_IDS.podReady,
            entityStatePath: "/selectedEntity",
            latestStatePath: `/metricsLatest/${K8S_METRIC_IDS.podReady}`,
          },
        },
        "pod-restarts-card": {
          type: "MetricStatCard",
          props: {
            label: "Restarts",
            metricId: K8S_METRIC_IDS.podRestartsTotal,
            unit: "count",
            entityStatePath: "/selectedEntity",
            latestStatePath: `/metricsLatest/${K8S_METRIC_IDS.podRestartsTotal}`,
          },
        },
        "pod-logs": {
          type: "LogPanel",
          props: {
            title: "Pod Logs",
            streamId: K8S_STREAM_IDS.podLogs,
            targetEntityStatePath: "/selectedEntity",
          },
        },
        "pod-actions": {
          type: "Section",
          props: {
            title: "Pod Actions",
          },
          children: ["pod-describe-button", "restart-pod", "delete-pod"],
        },
        "pod-describe-button": {
          type: "ActionButton",
          props: {
            label: "Describe",
            variant: "secondary",
          },
          on: {
            press: {
              action: "plugin.runAction",
              params: {
                pluginId: K8S_PLUGIN_ID,
                actionId: K8S_ACTION_IDS.describeResource,
                target: {
                  entityRef: {
                    $state: "/selectedEntity/ref",
                  },
                },
                input: {},
              },
            },
          },
        },
        "restart-pod": {
          type: "ActionButton",
          props: {
            label: "Restart Pod",
            variant: "secondary",
          },
          on: {
            press: {
              action: "plugin.runAction",
              params: {
                pluginId: K8S_PLUGIN_ID,
                actionId: K8S_ACTION_IDS.restartPod,
                target: {
                  entityRef: {
                    $state: "/selectedEntity/ref",
                  },
                },
                input: {},
              },
              confirm: {
                title: "Restart Pod",
                message: "Delete this pod so Kubernetes recreates it?",
                confirmLabel: "Restart",
              },
            },
          },
        },
        "delete-pod": {
          type: "ActionButton",
          props: {
            label: "Delete Pod",
            variant: "destructive",
          },
          on: {
            press: {
              action: "plugin.runAction",
              params: {
                pluginId: K8S_PLUGIN_ID,
                actionId: K8S_ACTION_IDS.deletePod,
                target: {
                  entityRef: {
                    $state: "/selectedEntity/ref",
                  },
                },
                input: {},
              },
              confirm: {
                title: "Delete Pod",
                message: "Delete this pod immediately?",
                confirmLabel: "Delete",
                variant: "danger",
              },
            },
          },
        },
      },
    },
  },
]
