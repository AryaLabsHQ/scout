export interface System {
  id: string
  hostname: string
  tailscaleIp: string | null
  status: SystemStatus
  capabilities: AgentCapabilities
  lastSeen: number // unix timestamp ms
  createdAt: number
}

export type SystemStatus = "online" | "offline" | "pending"

export interface AgentInfo {
  systemId: string
  hostname: string
  version: string
  platform: string
}

export interface AgentCapabilities {
  system: boolean
  network: boolean
  process: boolean
  temperature: boolean
  gpu: boolean
  smart: boolean
}

export type CollectorCapability =
  | "system"
  | "network"
  | "process"
  | "temperature"
  | "gpu"
  | "smart"
  | "systemd"
  | "docker"
  | "k8s"
