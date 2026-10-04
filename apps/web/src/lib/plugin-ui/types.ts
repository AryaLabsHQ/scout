export interface EntityRef {
  readonly pluginId: string
  readonly kind: string
  readonly nodeId: string
  readonly id: string
}

export interface EntityRelationship {
  readonly type: string
  readonly target: EntityRef
}

export interface EntitySnapshot {
  readonly ref: EntityRef
  readonly ts: number
  readonly displayName?: string
  readonly status?: string
  readonly labels?: Record<string, string>
  readonly spec?: unknown
  readonly state?: unknown
  readonly relationships?: ReadonlyArray<EntityRelationship>
}

export interface MetricPoint {
  readonly pluginId: string
  readonly metricId: string
  readonly ts: number
  readonly entity?: EntityRef
  readonly value: number
  readonly unit?: string
  readonly tags?: Record<string, string>
}

export interface EventRecord {
  readonly pluginId: string
  readonly eventId: string
  readonly ts: number
  readonly entity?: EntityRef
  readonly severity: "info" | "warning" | "error"
  readonly message?: string
  readonly payload?: unknown
}

export interface PluginUiActionBinding {
  readonly action: string
  readonly params?: Record<string, unknown>
  readonly confirm?: {
    readonly title: string
    readonly message: string
    readonly confirmLabel?: string
    readonly cancelLabel?: string
    readonly variant?: "default" | "danger"
  }
  readonly onSuccess?:
    | { readonly navigate: string }
    | { readonly set: Record<string, unknown> }
    | { readonly action: string }
  readonly onError?: { readonly set: Record<string, unknown> } | { readonly action: string }
  readonly preventDefault?: boolean
}

export interface PluginUiElement {
  readonly type: string
  readonly props: Record<string, unknown>
  readonly children?: ReadonlyArray<string>
  readonly visible?: unknown
  readonly on?: Record<string, PluginUiActionBinding | ReadonlyArray<PluginUiActionBinding>>
  readonly repeat?: {
    readonly statePath: string
    readonly key?: string
  }
  readonly watch?: Record<string, PluginUiActionBinding | ReadonlyArray<PluginUiActionBinding>>
}

export interface PluginUiSpec {
  readonly root: string
  readonly elements: Record<string, PluginUiElement>
  readonly state?: Record<string, unknown>
}

export type PluginUiScreenKind = "overview" | "entity-list" | "entity-detail"

export interface PluginUiScreen {
  readonly id: string
  readonly pluginId: string
  readonly kind: PluginUiScreenKind
  readonly title: string
  readonly entityKind?: string
  readonly spec: PluginUiSpec
}

export interface PluginFormOptionMetadata {
  readonly label: string
  readonly value: string | number | boolean
}

export interface PluginFormFieldMetadata {
  readonly name: string
  readonly label: string
  readonly kind: "string" | "number" | "boolean" | "enum"
  readonly required: boolean
  readonly multiline?: boolean
  readonly options?: ReadonlyArray<PluginFormOptionMetadata>
}

export type PluginInputMetadata =
  | { readonly kind: "none" }
  | { readonly kind: "struct"; readonly fields: ReadonlyArray<PluginFormFieldMetadata> }
  | { readonly kind: "unsupported"; readonly reason: string }

export interface PluginActionMetadata {
  readonly id: string
  readonly displayName: string
  readonly description?: string
  readonly requiresConfirmation: boolean
  readonly targetKinds: ReadonlyArray<string>
  readonly input: PluginInputMetadata
}

export interface PluginStreamMetadata {
  readonly id: string
  readonly displayName: string
  readonly description?: string
  readonly kind: string
  readonly targetKinds: ReadonlyArray<string>
  readonly input: PluginInputMetadata
}

export interface PluginDetailResponse {
  readonly manifest: {
    readonly id: string
    readonly displayName: string
    readonly version: string
    readonly description?: string
  }
  readonly agent?: {
    readonly actions: ReadonlyArray<PluginActionMetadata>
    readonly streams: ReadonlyArray<PluginStreamMetadata>
  }
  readonly hub?: {
    readonly alerts: ReadonlyArray<Record<string, unknown>>
  }
  readonly web?: {
    readonly screens: ReadonlyArray<PluginUiScreen>
  }
}

export type PluginColumnSource =
  | { readonly type?: "field"; readonly kind?: "field"; readonly path: string }
  | { readonly type?: "label"; readonly kind?: "label"; readonly key: string }
  | { readonly type?: "status"; readonly kind?: "status" }
  | { readonly type?: "metric"; readonly kind?: "metric"; readonly metricId: string }

export interface PluginTableColumn {
  readonly id: string
  readonly label: string
  readonly source: PluginColumnSource
  readonly presentation?: "badge"
}

export interface PluginMetricRef {
  readonly id?: string
  readonly metricId: string
  readonly label?: string
  readonly unit?: string
}

export interface PluginActionItem {
  readonly id?: string
  readonly actionId?: string
  readonly label?: string
  readonly variant?: "default" | "outline" | "secondary" | "ghost" | "destructive"
  readonly action?: PluginUiActionBinding
}

export interface PluginRouteState {
  readonly system: Record<string, unknown>
  readonly plugin: PluginDetailResponse
  readonly entities: ReadonlyArray<EntitySnapshot>
  readonly metrics: ReadonlyArray<MetricPoint>
  readonly events: ReadonlyArray<EventRecord>
  readonly entitiesByKind: Record<string, ReadonlyArray<EntitySnapshot>>
  readonly metricsLatest: Record<string, number | null>
  readonly metricsHistory: Record<string, ReadonlyArray<MetricPoint>>
  readonly selectedEntity?: EntitySnapshot
  readonly forms?: Record<string, unknown>
  readonly ui: {
    readonly activePrimaryScreenId: string | null
    readonly activeDetailScreenId?: string | null
    readonly selectedEntityRef?: EntityRef
    readonly actionForm?: {
      readonly actionId: string
      readonly targetRef?: EntityRef
      readonly values: Record<string, unknown>
      readonly openedAt: number
    }
    readonly actionResult?: unknown
    readonly actionError?: string
  }
}

export interface PluginUiFrame {
  readonly currentScreenId: string
  readonly currentScreen: PluginUiScreen
  readonly selectedEntity: EntitySnapshot | null
  readonly primaryScreens: ReadonlyArray<PluginUiScreen>
  readonly detailScreens: ReadonlyArray<PluginUiScreen>
}
