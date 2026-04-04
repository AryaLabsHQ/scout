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
  systemd: boolean
  docker: boolean
  k8s: boolean
}

export type CollectorCapability = keyof AgentCapabilities
