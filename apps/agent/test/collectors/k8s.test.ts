import { describe, expect, it } from "vitest"
import {
  parseK8sDeploymentList,
  parseK8sIngressList,
  parseK8sJobList,
  parseK8sNodeList,
  parseK8sPodList,
  parseK8sServiceList,
} from "../../src/collectors/k8s.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PODS_JSON = JSON.stringify({
  kind: "PodList",
  items: [
    {
      metadata: {
        name: "web-6d7f84b6c9-xk2pq",
        namespace: "default",
        creationTimestamp: "2024-01-01T00:00:00Z",
      },
      spec: {
        nodeName: "node-1",
        containers: [
          { name: "web", image: "nginx:latest" },
          { name: "sidecar", image: "busybox:1.35" },
        ],
      },
      status: {
        phase: "Running",
        containerStatuses: [
          {
            name: "web",
            image: "nginx:latest",
            ready: true,
            restartCount: 2,
            state: { running: { startedAt: "2024-01-01T00:01:00Z" } },
          },
          {
            name: "sidecar",
            image: "busybox:1.35",
            ready: true,
            restartCount: 0,
            state: { running: { startedAt: "2024-01-01T00:01:00Z" } },
          },
        ],
      },
    },
    {
      metadata: {
        name: "pending-pod",
        namespace: "staging",
        creationTimestamp: "2024-01-01T00:00:00Z",
      },
      spec: {
        nodeName: "",
        containers: [{ name: "app", image: "myapp:latest" }],
      },
      status: {
        phase: "Pending",
        containerStatuses: [
          {
            name: "app",
            image: "myapp:latest",
            ready: false,
            restartCount: 0,
            state: { waiting: { reason: "ContainerCreating" } },
          },
        ],
      },
    },
    {
      metadata: {
        name: "failed-pod",
        namespace: "default",
        creationTimestamp: "2024-01-01T00:00:00Z",
      },
      spec: {
        nodeName: "node-2",
        containers: [{ name: "job", image: "myimage:v1" }],
      },
      status: {
        phase: "Failed",
        containerStatuses: [
          {
            name: "job",
            image: "myimage:v1",
            ready: false,
            restartCount: 5,
            state: { terminated: { reason: "OOMKilled" } },
          },
        ],
      },
    },
  ],
})

const DEPLOYMENTS_JSON = JSON.stringify({
  kind: "DeploymentList",
  items: [
    {
      metadata: {
        name: "web-deployment",
        namespace: "default",
        creationTimestamp: "2024-01-01T00:00:00Z",
      },
      spec: { replicas: 3 },
      status: {
        desiredReplicas: 3,
        readyReplicas: 2,
        updatedReplicas: 3,
      },
    },
    {
      metadata: {
        name: "api-deployment",
        namespace: "backend",
        creationTimestamp: "2024-01-01T00:00:00Z",
      },
      spec: { replicas: 5 },
      status: {
        desiredReplicas: 5,
        readyReplicas: 5,
        updatedReplicas: 5,
      },
    },
  ],
})

const SERVICES_JSON = JSON.stringify({
  kind: "ServiceList",
  items: [
    {
      metadata: { name: "web-svc", namespace: "default" },
      spec: {
        type: "LoadBalancer",
        clusterIP: "10.0.0.1",
        ports: [
          { name: "http", port: 80, targetPort: 8080, protocol: "TCP" },
          { name: "https", port: 443, targetPort: 8443, protocol: "TCP" },
        ],
      },
    },
    {
      metadata: { name: "db-svc", namespace: "default" },
      spec: {
        type: "ClusterIP",
        clusterIP: "10.0.0.2",
        ports: [{ port: 5432, targetPort: 5432, protocol: "TCP" }],
      },
    },
  ],
})

const INGRESSES_JSON = JSON.stringify({
  kind: "IngressList",
  items: [
    {
      metadata: { name: "main-ingress", namespace: "default" },
      spec: {
        rules: [
          {
            host: "example.com",
            http: {
              paths: [
                {
                  path: "/api",
                  backend: { service: { name: "api-svc", port: { number: 8080 } } },
                },
                {
                  path: "/",
                  backend: { service: { name: "web-svc", port: { number: 80 } } },
                },
              ],
            },
          },
        ],
      },
    },
  ],
})

const JOBS_JSON = JSON.stringify({
  kind: "JobList",
  items: [
    {
      metadata: { name: "migration-job", namespace: "default" },
      spec: { completions: 1 },
      status: {
        succeeded: 1,
        failed: 0,
        active: 0,
        startTime: "2024-01-01T00:00:00Z",
        completionTime: "2024-01-01T00:01:30Z",
      },
    },
    {
      metadata: { name: "batch-job", namespace: "default" },
      spec: { completions: 5 },
      status: {
        succeeded: 3,
        failed: 1,
        active: 1,
        startTime: "2024-01-01T00:00:00Z",
        // still running, no completionTime
      },
    },
  ],
})

const NODES_JSON = JSON.stringify({
  kind: "NodeList",
  items: [
    {
      metadata: {
        name: "node-1",
        labels: {
          "node-role.kubernetes.io/control-plane": "",
          "node-role.kubernetes.io/master": "",
        },
      },
      status: {
        allocatable: { cpu: "4", memory: "8Gi" },
        conditions: [
          { type: "Ready", status: "True" },
          { type: "MemoryPressure", status: "False" },
          { type: "DiskPressure", status: "False" },
        ],
      },
    },
    {
      metadata: {
        name: "node-2",
        labels: {},
      },
      status: {
        allocatable: { cpu: "8", memory: "16Gi" },
        conditions: [
          { type: "Ready", status: "False" },
        ],
      },
    },
  ],
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseK8sPodList", () => {
  it("parses running, pending, and failed pods", () => {
    const result = parseK8sPodList(PODS_JSON)
    expect(result).toHaveLength(3)

    const running = result.find(p => p.name === "web-6d7f84b6c9-xk2pq")
    expect(running!.phase).toBe("Running")
    expect(running!.namespace).toBe("default")

    const pending = result.find(p => p.name === "pending-pod")
    expect(pending!.phase).toBe("Pending")
    expect(pending!.namespace).toBe("staging")

    const failed = result.find(p => p.name === "failed-pod")
    expect(failed!.phase).toBe("Failed")
  })

  it("sums restart counts across all containers", () => {
    const result = parseK8sPodList(PODS_JSON)
    const running = result.find(p => p.name === "web-6d7f84b6c9-xk2pq")
    // web: 2 restarts + sidecar: 0 = 2 total
    expect(running!.restarts).toBe(2)

    const failed = result.find(p => p.name === "failed-pod")
    expect(failed!.restarts).toBe(5)
  })

  it("maps container states correctly", () => {
    const result = parseK8sPodList(PODS_JSON)
    const running = result.find(p => p.name === "web-6d7f84b6c9-xk2pq")
    const webContainer = running!.containers.find(c => c.name === "web")
    expect(webContainer!.state).toBe("running")
    expect(webContainer!.ready).toBe(true)

    const pending = result.find(p => p.name === "pending-pod")
    const appContainer = pending!.containers.find(c => c.name === "app")
    expect(appContainer!.state).toBe("waiting")
    expect(appContainer!.reason).toBe("ContainerCreating")
  })

  it("maps terminated container with reason", () => {
    const result = parseK8sPodList(PODS_JSON)
    const failed = result.find(p => p.name === "failed-pod")
    const container = failed!.containers[0]!
    expect(container.state).toBe("terminated")
    expect(container.reason).toBe("OOMKilled")
  })

  it("sets cpuMillicores and memBytes to null (no metrics-server)", () => {
    const result = parseK8sPodList(PODS_JSON)
    for (const pod of result) {
      expect(pod.cpuMillicores).toBeNull()
      expect(pod.memBytes).toBeNull()
    }
  })

  it("returns empty array for invalid JSON", () => {
    expect(parseK8sPodList("not json")).toEqual([])
    expect(parseK8sPodList("{}")).toEqual([])
  })
})

describe("parseK8sDeploymentList", () => {
  it("parses deployment with desired != ready", () => {
    const result = parseK8sDeploymentList(DEPLOYMENTS_JSON)
    expect(result).toHaveLength(2)

    const web = result.find(d => d.name === "web-deployment")
    expect(web!.desiredReplicas).toBe(3)
    expect(web!.readyReplicas).toBe(2)
    expect(web!.updatedReplicas).toBe(3)
    expect(web!.namespace).toBe("default")
  })

  it("parses fully-ready deployment", () => {
    const result = parseK8sDeploymentList(DEPLOYMENTS_JSON)
    const api = result.find(d => d.name === "api-deployment")
    expect(api!.desiredReplicas).toBe(5)
    expect(api!.readyReplicas).toBe(5)
    expect(api!.namespace).toBe("backend")
  })

  it("returns empty array for invalid JSON", () => {
    expect(parseK8sDeploymentList("not json")).toEqual([])
  })
})

describe("parseK8sServiceList", () => {
  it("parses service type and clusterIP", () => {
    const result = parseK8sServiceList(SERVICES_JSON)
    expect(result).toHaveLength(2)

    const web = result.find(s => s.name === "web-svc")
    expect(web!.type).toBe("LoadBalancer")
    expect(web!.clusterIP).toBe("10.0.0.1")
  })

  it("parses service ports", () => {
    const result = parseK8sServiceList(SERVICES_JSON)
    const web = result.find(s => s.name === "web-svc")
    expect(web!.ports).toHaveLength(2)
    expect(web!.ports[0]!.port).toBe(80)
    expect(web!.ports[0]!.targetPort).toBe(8080)
    expect(web!.ports[0]!.protocol).toBe("TCP")
    expect(web!.ports[0]!.name).toBe("http")
  })

  it("returns empty array for invalid JSON", () => {
    expect(parseK8sServiceList("")).toEqual([])
  })
})

describe("parseK8sIngressList", () => {
  it("parses ingress rules and paths", () => {
    const result = parseK8sIngressList(INGRESSES_JSON)
    expect(result).toHaveLength(1)

    const ingress = result[0]!
    expect(ingress.name).toBe("main-ingress")
    expect(ingress.rules).toHaveLength(1)
    expect(ingress.rules[0]!.host).toBe("example.com")
    expect(ingress.rules[0]!.paths).toHaveLength(2)
  })

  it("maps backend service and port", () => {
    const result = parseK8sIngressList(INGRESSES_JSON)
    const apiPath = result[0]!.rules[0]!.paths.find(p => p.path === "/api")
    expect(apiPath!.backend).toBe("api-svc")
    expect(apiPath!.port).toBe(8080)
  })

  it("returns empty array for invalid JSON", () => {
    expect(parseK8sIngressList("{}")).toEqual([])
  })
})

describe("parseK8sJobList", () => {
  it("parses completed job with duration", () => {
    const result = parseK8sJobList(JOBS_JSON)
    const migration = result.find(j => j.name === "migration-job")
    expect(migration!.completions).toBe(1)
    expect(migration!.succeeded).toBe(1)
    expect(migration!.failed).toBe(0)
    expect(migration!.active).toBe(0)
    // startTime to completionTime: 90 seconds
    expect(migration!.duration).toBe(90)
  })

  it("parses in-progress job with active duration", () => {
    const result = parseK8sJobList(JOBS_JSON)
    const batch = result.find(j => j.name === "batch-job")
    expect(batch!.succeeded).toBe(3)
    expect(batch!.failed).toBe(1)
    expect(batch!.active).toBe(1)
    // duration is measured from startTime to now (dynamic), just check it's > 0
    expect(batch!.duration).toBeGreaterThan(0)
  })

  it("returns empty array for invalid JSON", () => {
    expect(parseK8sJobList("not json")).toEqual([])
  })
})

describe("parseK8sNodeList", () => {
  it("parses Ready node with roles", () => {
    const result = parseK8sNodeList(NODES_JSON)
    const node1 = result.find(n => n.name === "node-1")
    expect(node1!.status).toBe("Ready")
    expect(node1!.roles).toContain("control-plane")
    expect(node1!.roles).toContain("master")
  })

  it("parses NotReady node", () => {
    const result = parseK8sNodeList(NODES_JSON)
    const node2 = result.find(n => n.name === "node-2")
    expect(node2!.status).toBe("NotReady")
  })

  it("defaults to worker role when no role labels", () => {
    const result = parseK8sNodeList(NODES_JSON)
    const node2 = result.find(n => n.name === "node-2")
    expect(node2!.roles).toEqual(["worker"])
  })

  it("parses allocatable resources", () => {
    const result = parseK8sNodeList(NODES_JSON)
    const node1 = result.find(n => n.name === "node-1")
    expect(node1!.allocatable.cpu).toBe("4")
    expect(node1!.allocatable.memory).toBe("8Gi")
  })

  it("parses conditions array", () => {
    const result = parseK8sNodeList(NODES_JSON)
    const node1 = result.find(n => n.name === "node-1")
    expect(node1!.conditions).toHaveLength(3)
    const readyCond = node1!.conditions.find(c => c.type === "Ready")
    expect(readyCond!.status).toBe("True")
  })

  it("returns empty array for invalid JSON", () => {
    expect(parseK8sNodeList("not json")).toEqual([])
  })
})
