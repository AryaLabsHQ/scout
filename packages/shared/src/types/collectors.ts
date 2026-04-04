import type { Effect } from "effect"
import type { AgentCapabilities, CollectorCapability } from "./system.js"

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

export type { AgentCapabilities }
