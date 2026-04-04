import { Schema } from "effect"

// ---- CPU ----

const CpuBreakdownSchema = Schema.Struct({
  user: Schema.Number,
  system: Schema.Number,
  iowait: Schema.Number,
  steal: Schema.Number,
  idle: Schema.Number,
})

const CpuMetricsSchema = Schema.Struct({
  usage: Schema.Number,
  cores: Schema.Number,
  perCore: Schema.Array(Schema.Number),
  breakdown: CpuBreakdownSchema,
})

// ---- Memory ----

const MemoryMetricsSchema = Schema.Struct({
  used: Schema.Number,
  total: Schema.Number,
  available: Schema.Number,
  buffersCache: Schema.Number,
  swap: Schema.Struct({
    used: Schema.Number,
    total: Schema.Number,
  }),
})

// ---- Disk ----

const DiskMetricsSchema = Schema.Struct({
  mount: Schema.String,
  device: Schema.String,
  used: Schema.Number,
  total: Schema.Number,
  readBytesPerSec: Schema.Number,
  writeBytesPerSec: Schema.Number,
})

// ---- System ----

const SystemMetricsSchema = Schema.Struct({
  cpu: CpuMetricsSchema,
  memory: MemoryMetricsSchema,
  disks: Schema.Array(DiskMetricsSchema),
  loadAvg: Schema.Tuple([Schema.Number, Schema.Number, Schema.Number]),
  uptime: Schema.Number,
})

// ---- Network ----

const NetworkInterfaceMetricsSchema = Schema.Struct({
  name: Schema.String,
  rxBytesPerSec: Schema.Number,
  txBytesPerSec: Schema.Number,
  rxPacketsPerSec: Schema.Number,
  txPacketsPerSec: Schema.Number,
})

// ---- GPU ----

const GpuMetricsSchema = Schema.Struct({
  name: Schema.String,
  index: Schema.Number,
  usage: Schema.Number,
  memUsed: Schema.Number,
  memTotal: Schema.Number,
  temperature: Schema.Number,
  powerWatts: Schema.Number,
})

// ---- SMART ----

const SmartMetricsSchema = Schema.Struct({
  device: Schema.String,
  model: Schema.String,
  serial: Schema.String,
  health: Schema.Literals(["PASSED", "FAILED"]),
  temperature: Schema.NullOr(Schema.Number),
  powerOnHours: Schema.NullOr(Schema.Number),
  reallocatedSectors: Schema.NullOr(Schema.Number),
})

// ---- Temperature ----

const TemperatureMetricsSchema = Schema.Struct({
  label: Schema.String,
  source: Schema.String,
  celsius: Schema.Number,
})

// ---- Process ----

const ProcessMetricsSchema = Schema.Struct({
  pid: Schema.Number,
  name: Schema.String,
  cpuPercent: Schema.Number,
  memPercent: Schema.Number,
  memBytes: Schema.Number,
  user: Schema.String,
})

// ---- Systemd ----

const SystemdServiceMetricsSchema = Schema.Struct({
  unit: Schema.String,
  description: Schema.String,
  loadState: Schema.Literals(["loaded", "not-found", "masked", "error"]),
  activeState: Schema.Literals(["active", "inactive", "failed", "activating", "deactivating"]),
  subState: Schema.String,
  pid: Schema.NullOr(Schema.Number),
  memoryBytes: Schema.NullOr(Schema.Number),
  cpuUsageNs: Schema.NullOr(Schema.Number),
})

// ---- Docker ----

const DockerContainerMetricsSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  image: Schema.String,
  status: Schema.String,
  state: Schema.Literals(["running", "exited", "paused", "restarting", "dead", "created"]),
  cpuPercent: Schema.Number,
  memUsed: Schema.Number,
  memLimit: Schema.Number,
  netRx: Schema.Number,
  netTx: Schema.Number,
  blockRead: Schema.Number,
  blockWrite: Schema.Number,
  uptime: Schema.Number,
})

// ---- K8s ----

const K8sContainerSchema = Schema.Struct({
  name: Schema.String,
  image: Schema.String,
  ready: Schema.Boolean,
  restartCount: Schema.Number,
  state: Schema.Literals(["running", "waiting", "terminated"]),
  reason: Schema.NullOr(Schema.String),
})

const K8sPodSchema = Schema.Struct({
  name: Schema.String,
  namespace: Schema.String,
  nodeName: Schema.String,
  phase: Schema.Literals(["Pending", "Running", "Succeeded", "Failed", "Unknown"]),
  restarts: Schema.Number,
  containers: Schema.Array(K8sContainerSchema),
  cpuMillicores: Schema.NullOr(Schema.Number),
  memBytes: Schema.NullOr(Schema.Number),
  age: Schema.Number,
})

const K8sDeploymentSchema = Schema.Struct({
  name: Schema.String,
  namespace: Schema.String,
  desiredReplicas: Schema.Number,
  readyReplicas: Schema.Number,
  updatedReplicas: Schema.Number,
  age: Schema.Number,
})

const K8sServiceSchema = Schema.Struct({
  name: Schema.String,
  namespace: Schema.String,
  type: Schema.Literals(["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"]),
  clusterIP: Schema.String,
  ports: Schema.Array(
    Schema.Struct({
      port: Schema.Number,
      targetPort: Schema.Number,
      protocol: Schema.String,
      name: Schema.optionalKey(Schema.String),
    }),
  ),
})

const K8sIngressSchema = Schema.Struct({
  name: Schema.String,
  namespace: Schema.String,
  rules: Schema.Array(
    Schema.Struct({
      host: Schema.String,
      paths: Schema.Array(
        Schema.Struct({
          path: Schema.String,
          backend: Schema.String,
          port: Schema.Number,
        }),
      ),
    }),
  ),
})

const K8sJobSchema = Schema.Struct({
  name: Schema.String,
  namespace: Schema.String,
  completions: Schema.Number,
  succeeded: Schema.Number,
  failed: Schema.Number,
  active: Schema.Number,
  duration: Schema.NullOr(Schema.Number),
})

const K8sNodeSchema = Schema.Struct({
  name: Schema.String,
  status: Schema.Literals(["Ready", "NotReady", "Unknown"]),
  roles: Schema.Array(Schema.String),
  allocatable: Schema.Struct({
    cpu: Schema.String,
    memory: Schema.String,
  }),
  conditions: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      status: Schema.String,
    }),
  ),
})

const K8sWorkloadMetricsSchema = Schema.Struct({
  pods: Schema.Array(K8sPodSchema),
  deployments: Schema.Array(K8sDeploymentSchema),
  services: Schema.Array(K8sServiceSchema),
  ingresses: Schema.Array(K8sIngressSchema),
  jobs: Schema.Array(K8sJobSchema),
  nodes: Schema.Array(K8sNodeSchema),
})

// ---- AgentReport ----

export const AgentReportSchema = Schema.Struct({
  systemId: Schema.String,
  timestamp: Schema.Number,
  system: SystemMetricsSchema,
  network: Schema.Array(NetworkInterfaceMetricsSchema),
  processes: Schema.optionalKey(Schema.Array(ProcessMetricsSchema)),
  temperatures: Schema.optionalKey(Schema.Array(TemperatureMetricsSchema)),
  gpu: Schema.optionalKey(Schema.Array(GpuMetricsSchema)),
  smart: Schema.optionalKey(Schema.Array(SmartMetricsSchema)),
  systemd: Schema.optionalKey(Schema.Array(SystemdServiceMetricsSchema)),
  docker: Schema.optionalKey(Schema.Array(DockerContainerMetricsSchema)),
  k8s: Schema.optionalKey(K8sWorkloadMetricsSchema),
})

export const decodeAgentReport = Schema.decodeUnknownEffect(AgentReportSchema)
