export interface DockerContainerMetrics {
  id: string
  name: string
  image: string
  status: string // e.g. "Up 3 hours"
  state: "running" | "exited" | "paused" | "restarting" | "dead" | "created"
  cpuPercent: number
  memUsed: number // bytes
  memLimit: number
  netRx: number // bytes total
  netTx: number
  blockRead: number
  blockWrite: number
  uptime: number // seconds
}
