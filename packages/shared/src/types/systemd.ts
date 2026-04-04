export interface SystemdServiceMetrics {
  unit: string // e.g. "nginx.service"
  description: string
  loadState: "loaded" | "not-found" | "masked" | "error"
  activeState: "active" | "inactive" | "failed" | "activating" | "deactivating"
  subState: string // e.g. "running", "dead", "exited"
  pid: number | null
  memoryBytes: number | null
  cpuUsageNs: number | null
}

export interface JournalEntry {
  timestamp: number
  unit: string
  priority: number // 0-7 (syslog)
  message: string
  pid: number | null
}

export interface UnitFile {
  path: string
  content: string
}
