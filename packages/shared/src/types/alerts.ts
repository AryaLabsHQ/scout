export type AlertSeverity = "warning" | "critical"
export type AlertState = "active" | "acknowledged" | "resolved"

export interface AlertRule {
  id: string
  metric: string
  operator: ">" | "<" | "=" | "!="
  threshold: number
  consecutiveCount: number
  severity: AlertSeverity
  enabled: boolean
  createdAt: number
}

export interface Alert {
  id: string
  ruleId: string
  systemId: string
  state: AlertState
  severity: AlertSeverity
  metric: string
  value: number
  triggeredAt: number
  acknowledgedAt: number | null
  resolvedAt: number | null
}
