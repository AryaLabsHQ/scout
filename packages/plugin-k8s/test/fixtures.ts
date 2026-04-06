import { Effect } from "effect"
import type { K8sDependencies, K8sResourceSnapshot } from "../src/k8s.js"

const listResponse = <T>(items: ReadonlyArray<T>): string =>
  JSON.stringify({
    apiVersion: "v1",
    items,
  })

interface FixtureCommandResponse {
  readonly stdout: string
  readonly stderr?: string
  readonly exitCode: number
}

export const fixtureSnapshot: K8sResourceSnapshot = {
  cluster: {
    id: "prod-cluster",
    name: "prod-cluster",
    currentContext: "dev-us-east",
    defaultNamespace: "team-a",
    server: "https://10.0.0.1",
  },
  namespaces: [
    {
      metadata: {
        name: "team-a",
        labels: {
          team: "platform",
        },
      },
      status: {
        phase: "Active",
      },
    },
    {
      metadata: {
        name: "kube-system",
      },
      status: {
        phase: "Active",
      },
    },
  ],
  nodes: [
    {
      metadata: {
        name: "ip-10-0-1-10",
        labels: {
          "topology.kubernetes.io/zone": "us-east-1a",
        },
      },
      spec: {
        providerID: "aws:///us-east-1a/i-123",
        podCIDR: "10.244.0.0/24",
      },
      status: {
        conditions: [
          {
            type: "Ready",
            status: "True",
          },
        ],
        addresses: [
          {
            type: "InternalIP",
            address: "10.0.1.10",
          },
        ],
        nodeInfo: {
          kubeletVersion: "v1.31.0",
          kernelVersion: "6.8.0",
          osImage: "Ubuntu 24.04",
          containerRuntimeVersion: "containerd://2.0.0",
        },
      },
    },
    {
      metadata: {
        name: "ip-10-0-1-11",
      },
      spec: {
        providerID: "aws:///us-east-1b/i-456",
        podCIDR: "10.244.1.0/24",
        unschedulable: true,
      },
      status: {
        conditions: [
          {
            type: "Ready",
            status: "False",
          },
        ],
        addresses: [
          {
            type: "InternalIP",
            address: "10.0.1.11",
          },
        ],
        nodeInfo: {
          kubeletVersion: "v1.31.0",
          kernelVersion: "6.8.0",
          osImage: "Ubuntu 24.04",
          containerRuntimeVersion: "containerd://2.0.0",
        },
      },
    },
  ],
  pods: [
    {
      metadata: {
        namespace: "team-a",
        name: "api-7d9bc6b5f6-abcde",
        labels: {
          app: "api",
          component: "server",
          "pod-template-hash": "7d9bc6b5f6",
        },
        ownerReferences: [
          {
            kind: "ReplicaSet",
            name: "api-7d9bc6b5f6",
            uid: "rs-1",
            controller: true,
          },
        ],
      },
      spec: {
        nodeName: "ip-10-0-1-10",
        serviceAccountName: "api",
        containers: [
          {
            name: "api",
            image: "ghcr.io/scout/api:1.2.3",
          },
        ],
      },
      status: {
        phase: "Running",
        podIP: "10.244.0.10",
        hostIP: "10.0.1.10",
        conditions: [
          {
            type: "Ready",
            status: "True",
          },
        ],
        containerStatuses: [
          {
            name: "api",
            ready: true,
            restartCount: 1,
          },
        ],
      },
    },
    {
      metadata: {
        namespace: "team-a",
        name: "api-7d9bc6b5f6-fghij",
        labels: {
          app: "api",
          component: "server",
          "pod-template-hash": "7d9bc6b5f6",
        },
        ownerReferences: [
          {
            kind: "ReplicaSet",
            name: "api-7d9bc6b5f6",
            uid: "rs-1",
            controller: true,
          },
        ],
      },
      spec: {
        nodeName: "ip-10-0-1-10",
        serviceAccountName: "api",
        containers: [
          {
            name: "api",
            image: "ghcr.io/scout/api:1.2.3",
          },
        ],
      },
      status: {
        phase: "Running",
        podIP: "10.244.0.11",
        hostIP: "10.0.1.10",
        conditions: [
          {
            type: "Ready",
            status: "True",
          },
        ],
        containerStatuses: [
          {
            name: "api",
            ready: true,
            restartCount: 0,
          },
        ],
      },
    },
    {
      metadata: {
        namespace: "team-a",
        name: "data-migrate-8z2kh",
        labels: {
          "job-name": "data-migrate",
        },
        ownerReferences: [
          {
            kind: "Job",
            name: "data-migrate",
            uid: "job-1",
            controller: true,
          },
        ],
      },
      spec: {
        nodeName: "ip-10-0-1-11",
        serviceAccountName: "jobs",
        containers: [
          {
            name: "migrate",
            image: "ghcr.io/scout/migrate:1.2.3",
          },
        ],
      },
      status: {
        phase: "Succeeded",
        podIP: "10.244.1.20",
        hostIP: "10.0.1.11",
        conditions: [
          {
            type: "Ready",
            status: "False",
          },
        ],
        containerStatuses: [
          {
            name: "migrate",
            ready: false,
            restartCount: 0,
          },
        ],
      },
    },
  ],
  deployments: [
    {
      metadata: {
        namespace: "team-a",
        name: "api",
        labels: {
          app: "api",
        },
      },
      spec: {
        replicas: 2,
        strategy: {
          type: "RollingUpdate",
        },
        selector: {
          matchLabels: {
            app: "api",
            component: "server",
          },
        },
      },
      status: {
        readyReplicas: 2,
        availableReplicas: 2,
        updatedReplicas: 2,
        replicas: 2,
      },
    },
  ],
  services: [
    {
      metadata: {
        namespace: "team-a",
        name: "api",
        labels: {
          app: "api",
        },
      },
      spec: {
        type: "ClusterIP",
        clusterIP: "10.96.0.42",
        selector: {
          app: "api",
          component: "server",
        },
        ports: [
          {
            name: "http",
            port: 80,
            protocol: "TCP",
            targetPort: 8080,
          },
        ],
      },
    },
  ],
  ingresses: [
    {
      metadata: {
        namespace: "team-a",
        name: "api",
      },
      spec: {
        ingressClassName: "nginx",
        rules: [
          {
            host: "api.example.com",
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: {
                    service: {
                      name: "api",
                      port: {
                        number: 80,
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
      status: {
        loadBalancer: {
          ingress: [
            {
              hostname: "lb.example.com",
            },
          ],
        },
      },
    },
  ],
  jobs: [
    {
      metadata: {
        namespace: "team-a",
        name: "data-migrate",
      },
      spec: {
        completions: 1,
        parallelism: 1,
        backoffLimit: 2,
      },
      status: {
        succeeded: 1,
        startTime: "2026-04-06T10:00:00Z",
        completionTime: "2026-04-06T10:01:00Z",
      },
    },
  ],
  events: [
    {
      metadata: {
        namespace: "team-a",
        name: "api-7d9bc6b5f6-abcde.18291f4a9c0f4d7f",
      },
      reason: "BackOff",
      message: "Back-off restarting failed container",
      type: "Warning",
      eventTime: "2026-04-06T10:05:00Z",
      count: 3,
      involvedObject: {
        kind: "Pod",
        namespace: "team-a",
        name: "api-7d9bc6b5f6-abcde",
      },
    },
    {
      metadata: {
        name: "ip-10-0-1-11.18291f4ab37f0f84",
      },
      reason: "NodeNotReady",
      message: "Node ip-10-0-1-11 status is now: NodeNotReady",
      type: "Warning",
      eventTime: "2026-04-06T10:02:00Z",
      involvedObject: {
        kind: "Node",
        name: "ip-10-0-1-11",
      },
    },
  ],
}

const configViewResponse = JSON.stringify({
  "current-context": fixtureSnapshot.cluster.currentContext,
  contexts: [
    {
      name: fixtureSnapshot.cluster.currentContext,
      context: {
        cluster: fixtureSnapshot.cluster.name,
        namespace: fixtureSnapshot.cluster.defaultNamespace,
        user: "dev-user",
      },
    },
  ],
  clusters: [
    {
      name: fixtureSnapshot.cluster.name,
      cluster: {
        server: fixtureSnapshot.cluster.server,
      },
    },
  ],
})

export const createKubectlExecFixture = (
  overrides: Partial<Record<string, FixtureCommandResponse>> = {},
): K8sDependencies["exec"] => {
  const responses: Record<string, FixtureCommandResponse> = {
    "version --client=true --output=json": {
      stdout: JSON.stringify({
        clientVersion: {
          gitVersion: "v1.31.0",
        },
      }),
      exitCode: 0,
    },
    "config current-context": {
      stdout: `${fixtureSnapshot.cluster.currentContext}\n`,
      exitCode: 0,
    },
    "config view --minify -o json": {
      stdout: configViewResponse,
      exitCode: 0,
    },
    "get namespaces -o json": {
      stdout: listResponse(fixtureSnapshot.namespaces),
      exitCode: 0,
    },
    "get nodes -o json": {
      stdout: listResponse(fixtureSnapshot.nodes),
      exitCode: 0,
    },
    "get pods --all-namespaces -o json": {
      stdout: listResponse(fixtureSnapshot.pods),
      exitCode: 0,
    },
    "get deployments.apps --all-namespaces -o json": {
      stdout: listResponse(fixtureSnapshot.deployments),
      exitCode: 0,
    },
    "get services --all-namespaces -o json": {
      stdout: listResponse(fixtureSnapshot.services),
      exitCode: 0,
    },
    "get ingresses.networking.k8s.io --all-namespaces -o json": {
      stdout: listResponse(fixtureSnapshot.ingresses),
      exitCode: 0,
    },
    "get jobs.batch --all-namespaces -o json": {
      stdout: listResponse(fixtureSnapshot.jobs),
      exitCode: 0,
    },
    "get events --all-namespaces -o json": {
      stdout: listResponse(fixtureSnapshot.events),
      exitCode: 0,
    },
    ...overrides,
  }

  return (command, args) => {
    if (command !== "kubectl") {
      return Effect.fail(new Error(`Unexpected command: ${command}`))
    }

    const key = args.join(" ")
    const response = responses[key]
    if (response === undefined) {
      return Effect.fail(new Error(`Unexpected kubectl args: ${key}`))
    }

    return Effect.succeed({
      stdout: response.stdout,
      stderr: response.stderr ?? "",
      exitCode: response.exitCode,
    })
  }
}
