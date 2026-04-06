import type { Effect } from "effect"

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

export interface CollectorReport {
  capability: CollectorCapability
  data: unknown // typed per collector
}

export interface CollectorPlugin {
  readonly name: string
  readonly capability: CollectorCapability
  readonly detect: Effect.Effect<boolean>
  readonly collect: Effect.Effect<CollectorReport>
}
