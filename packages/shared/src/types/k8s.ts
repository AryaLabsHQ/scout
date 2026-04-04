export interface K8sWorkloadMetrics {
  pods: K8sPod[]
  deployments: K8sDeployment[]
  services: K8sService[]
  ingresses: K8sIngress[]
  jobs: K8sJob[]
  nodes: K8sNode[]
}

export interface K8sPod {
  name: string
  namespace: string
  nodeName: string
  phase: "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown"
  restarts: number
  containers: K8sContainer[]
  cpuMillicores: number | null // null if metrics-server unavailable
  memBytes: number | null
  age: number // seconds
}

export interface K8sContainer {
  name: string
  image: string
  ready: boolean
  restartCount: number
  state: "running" | "waiting" | "terminated"
  reason: string | null
}

export interface K8sDeployment {
  name: string
  namespace: string
  desiredReplicas: number
  readyReplicas: number
  updatedReplicas: number
  age: number
}

export interface K8sService {
  name: string
  namespace: string
  type: "ClusterIP" | "NodePort" | "LoadBalancer" | "ExternalName"
  clusterIP: string
  ports: Array<{ port: number; targetPort: number; protocol: string; name?: string }>
}

export interface K8sIngress {
  name: string
  namespace: string
  rules: Array<{
    host: string
    paths: Array<{ path: string; backend: string; port: number }>
  }>
}

export interface K8sJob {
  name: string
  namespace: string
  completions: number
  succeeded: number
  failed: number
  active: number
  duration: number | null // seconds
}

export interface K8sNode {
  name: string
  status: "Ready" | "NotReady" | "Unknown"
  roles: string[]
  allocatable: { cpu: string; memory: string }
  conditions: Array<{ type: string; status: string }>
}
