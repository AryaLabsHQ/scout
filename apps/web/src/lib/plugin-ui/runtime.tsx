import { createContext, useContext, useMemo, useSyncExternalStore, useState } from "react"
import { defineCatalog } from "@json-render/core"
import {
  createStateStore,
  defineRegistry,
  JSONUIProvider,
  Renderer,
  useStateStore,
} from "@json-render/react"
import { schema } from "@json-render/react/schema"
import { z } from "zod"
import { toast } from "sonner"
import { useConfirm, type ConfirmOptions } from "@/providers/confirm-provider"
import { MetricsChart } from "@/components/charts/metrics-chart"
import { LogViewer } from "@/components/log-viewer"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import type {
  EntityRef,
  EntityRelationship,
  EntitySnapshot,
  EventRecord,
  MetricPoint,
  PluginActionItem,
  PluginActionMetadata,
  PluginDetailResponse,
  PluginFormFieldMetadata,
  PluginInputMetadata,
  PluginMetricRef,
  PluginRouteState,
  PluginStreamMetadata,
  PluginTableColumn,
  PluginUiActionBinding,
  PluginUiScreen,
  PluginUiSpec,
} from "./types"

const stringOrDynamic = z.any()
const unknownRecord = z.record(z.string(), z.any())

const SCOUT_UI_CATALOG = defineCatalog(schema, {
  components: {
    Page: {
      props: z.object({
        title: stringOrDynamic.optional(),
        subtitle: stringOrDynamic.optional(),
        description: stringOrDynamic.optional(),
      }).passthrough(),
    },
    Section: {
      props: z.object({
        title: stringOrDynamic.optional(),
        description: stringOrDynamic.optional(),
      }).passthrough(),
    },
    Grid: {
      props: z.object({
        columns: z.number().optional(),
        gap: z.enum(["sm", "md", "lg"]).optional(),
      }).passthrough(),
    },
    Stack: {
      props: z.object({
        direction: z.enum(["row", "column"]).optional(),
        gap: z.enum(["sm", "md", "lg"]).optional(),
        justify: z.enum(["start", "center", "end", "between"]).optional(),
      }).passthrough(),
    },
    Text: {
      props: z.object({
        text: stringOrDynamic,
        tone: z.enum(["default", "muted", "danger"]).optional(),
      }).passthrough(),
    },
    Callout: {
      props: z.object({
        tone: z.enum(["default", "warning", "danger"]).optional(),
        text: stringOrDynamic,
      }).passthrough(),
    },
    StatGrid: {
      props: z.object({
        items: z.array(z.any()).optional(),
        metrics: z.array(z.any()).optional(),
        entityStatePath: z.string().optional(),
      }).passthrough(),
    },
    StatCard: {
      props: z.object({
        label: stringOrDynamic,
        metricId: z.string().optional(),
        value: stringOrDynamic.optional(),
        unit: z.string().optional(),
        tone: z.enum(["default", "success", "danger"]).optional(),
        entityStatePath: z.string().optional(),
      }).passthrough(),
    },
    MetricStatCard: {
      props: z.object({
        label: stringOrDynamic,
        metricId: z.string(),
        unit: z.string().optional(),
        entityStatePath: z.string().optional(),
      }).passthrough(),
    },
    EntityTable: {
      props: z.object({
        entityKind: z.string(),
        columns: z.array(z.any()),
        rowActions: z.array(z.any()).optional(),
        detailScreenId: z.string().optional(),
        statePath: z.string().optional(),
        empty: z.object({
          title: z.string().optional(),
          description: z.string().optional(),
        }).optional(),
      }).passthrough(),
    },
    DetailList: {
      props: z.object({
        title: stringOrDynamic.optional(),
        fields: z.array(z.any()).optional(),
        items: z.array(z.any()).optional(),
        entityStatePath: z.string().optional(),
      }).passthrough(),
    },
    MetricChart: {
      props: z.object({
        title: stringOrDynamic.optional(),
        metrics: z.array(z.any()).optional(),
        metricId: z.string().optional(),
        unit: z.string().optional(),
        entityStatePath: z.string().optional(),
      }).passthrough(),
    },
    ActionBar: {
      props: z.object({
        title: stringOrDynamic.optional(),
        actions: z.array(z.any()),
        entityStatePath: z.string().optional(),
      }).passthrough(),
    },
    LogPanel: {
      props: z.object({
        title: stringOrDynamic.optional(),
        streamId: z.string(),
        entityStatePath: z.string().optional(),
        targetEntityStatePath: z.string().optional(),
        fallbackTargetKinds: z.array(z.string()).optional(),
        relationshipTypes: z.array(z.string()).optional(),
        tail: z.number().optional(),
        statePath: z.string().optional(),
        input: z.any().optional(),
      }).passthrough(),
    },
    Form: {
      props: z.object({
        title: stringOrDynamic.optional(),
      }).passthrough(),
    },
    ActionButton: {
      props: z.object({
        label: stringOrDynamic,
        variant: z.enum(["default", "outline", "secondary", "ghost", "destructive"]).optional(),
      }).passthrough(),
    },
    TextField: {
      props: z.object({
        label: stringOrDynamic,
        statePath: z.string().optional(),
        bindState: z.string().optional(),
        placeholder: z.string().optional(),
        multiline: z.boolean().optional(),
      }).passthrough(),
    },
    NumberField: {
      props: z.object({
        label: stringOrDynamic,
        statePath: z.string().optional(),
        bindState: z.string().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      }).passthrough(),
    },
    BooleanField: {
      props: z.object({
        label: stringOrDynamic,
        statePath: z.string().optional(),
        bindState: z.string().optional(),
      }).passthrough(),
    },
    SelectField: {
      props: z.object({
        label: stringOrDynamic,
        statePath: z.string().optional(),
        bindState: z.string().optional(),
        options: z.array(
          z.object({
            label: z.string(),
            value: z.union([z.string(), z.number(), z.boolean()]),
          }),
        ),
      }).passthrough(),
    },
    ResultPanel: {
      props: z.object({
        resultStatePath: z.string(),
        errorStatePath: z.string(),
      }).passthrough(),
    },
  },
  actions: {
    "plugin.runAction": {
      params: unknownRecord.optional(),
    },
    "ui.selectEntity": {
      params: unknownRecord.optional(),
    },
    "ui.navigate": {
      params: unknownRecord.optional(),
    },
    "ui.closeActionForm": {
      params: unknownRecord.optional(),
    },
    "ui.showToast": {
      params: unknownRecord.optional(),
    },
    "ui.showActionResult": {
      params: unknownRecord.optional(),
    },
  },
})

type StateStore = ReturnType<typeof createStateStore>

interface PluginUiRuntimeActions {
  readonly selectEntity: (entity: EntitySnapshot | null) => void
  readonly navigate: (screenId: string, entity?: EntitySnapshot | null) => void
  readonly runAction: (args: {
    readonly action: PluginActionMetadata | undefined
    readonly targetRef?: EntityRef
    readonly explicitInput?: Record<string, unknown>
    readonly inputStatePath?: string
    readonly closeFormOnSuccess?: boolean
    /** Confirm-dialog copy from the screen's action binding, when it has one. */
    readonly confirmCopy?: PluginUiActionBinding["confirm"]
  }) => Promise<void>
}

const PluginUiRuntimeContext = createContext<PluginUiRuntimeActions | null>(null)

function usePluginUiRuntime(): PluginUiRuntimeActions {
  const value = useContext(PluginUiRuntimeContext)
  if (value === null) {
    throw new Error("Plugin UI runtime not configured")
  }
  return value
}

const CHART_COLORS = ["#ededed", "#a1a1a1", "#707070", "#4a4a4a", "#2e2e2e"] as const

const deepMerge = (left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> => {
  const output: Record<string, unknown> = { ...left }
  for (const [key, value] of Object.entries(right)) {
    const current = output[key]
    if (
      value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && current !== null
      && typeof current === "object"
      && !Array.isArray(current)
    ) {
      output[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>)
    } else {
      output[key] = value
    }
  }
  return output
}

const getByDotPath = (value: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined
    }
    return (current as Record<string, unknown>)[segment]
  }, value)

const getByStatePath = (value: unknown, path: string): unknown =>
  path
    .split("/")
    .filter(Boolean)
    .reduce<unknown>((current, segment) => {
      if (current === null || current === undefined || typeof current !== "object") {
        return undefined
      }
      return (current as Record<string, unknown>)[segment]
    }, value)

const entityRefEqual = (left: EntityRef | undefined, right: EntityRef | undefined): boolean =>
  left !== undefined
  && right !== undefined
  && left.pluginId === right.pluginId
  && left.kind === right.kind
  && left.nodeId === right.nodeId
  && left.id === right.id

const resolveEntityFromRef = (
  entities: ReadonlyArray<EntitySnapshot>,
  ref: EntityRef | undefined,
): EntitySnapshot | null =>
  ref === undefined ? null : entities.find((entity) => entityRefEqual(entity.ref, ref)) ?? null

const metricMatchesEntity = (metric: MetricPoint, entity: EntitySnapshot | null): boolean => {
  if (entity === null) {
    return metric.entity === undefined
  }

  return metric.entity !== undefined
    && entityRefEqual(metric.entity, entity.ref)
}

const latestMetric = (
  metrics: ReadonlyArray<MetricPoint>,
  metricId: string,
  entity: EntitySnapshot | null,
): MetricPoint | null => {
  const matches = metrics.filter(
    (metric) => metric.metricId === metricId && metricMatchesEntity(metric, entity),
  )
  return matches.length === 0 ? null : matches[matches.length - 1] ?? null
}

const formatMetricValue = (value: number, unit?: string): string => {
  if (unit === "bytes") {
    if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  }
  if (unit === "ns") {
    return `${Math.round(value / 1_000_000)} ms`
  }
  if (unit === "percent") {
    return `${Math.round(value)}%`
  }
  return String(Math.round(value))
}

const columnSourceKind = (column: PluginTableColumn): string =>
  column.source.kind ?? column.source.type ?? "field"

const resolveColumnValue = (
  entity: EntitySnapshot,
  column: PluginTableColumn,
  metrics: ReadonlyArray<MetricPoint>,
): unknown => {
  const sourceKind = columnSourceKind(column)
  switch (sourceKind) {
    case "field":
      return getByDotPath(entity, (column.source as { path: string }).path)
    case "label":
      return entity.labels?.[(column.source as { key: string }).key]
    case "status":
      return entity.status
    case "metric": {
      const metric = latestMetric(
        metrics,
        (column.source as { metricId: string }).metricId,
        entity,
      )
      return metric === null ? undefined : formatMetricValue(metric.value, metric.unit)
    }
    default:
      return undefined
  }
}

const buildTimeseries = (
  metrics: ReadonlyArray<MetricPoint>,
  metricRefs: ReadonlyArray<PluginMetricRef>,
  entity: EntitySnapshot | null,
): Array<Record<string, unknown>> => {
  const timestamps = Array.from(
    new Set(
      metrics
        .filter(
          (metric) =>
            metricRefs.some((ref) => ref.metricId === metric.metricId)
            && metricMatchesEntity(metric, entity),
        )
        .map((metric) => metric.ts),
    ),
  ).sort((a, b) => a - b)

  return timestamps.map((timestamp) => {
    const row: Record<string, unknown> = {
      time: new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }

    for (const ref of metricRefs) {
      let point: MetricPoint | undefined
      for (let index = metrics.length - 1; index >= 0; index -= 1) {
        const candidate = metrics[index]
        if (
          candidate !== undefined
          && candidate.metricId === ref.metricId
          && candidate.ts === timestamp
          && metricMatchesEntity(candidate, entity)
        ) {
          point = candidate
          break
        }
      }
      row[ref.metricId] = point?.value ?? 0
    }

    return row
  })
}

const normalizeChartUnit = (metricRefs: ReadonlyArray<PluginMetricRef>): "%" | "bytes" | "bytes/s" => {
  const unit = metricRefs[0]?.unit
  if (unit === "bytes" || unit === "bytes/s" || unit === "%") {
    return unit
  }
  return "%"
}

const createEntitiesByKind = (
  entities: ReadonlyArray<EntitySnapshot>,
): Record<string, ReadonlyArray<EntitySnapshot>> =>
  entities.reduce<Record<string, ReadonlyArray<EntitySnapshot>>>((acc, entity) => {
    const current = acc[entity.ref.kind] ?? []
    acc[entity.ref.kind] = [...current, entity]
    return acc
  }, {})

const createMetricsLatest = (
  metrics: ReadonlyArray<MetricPoint>,
): Record<string, number | null> => {
  const output: Record<string, number | null> = {}
  for (const metric of metrics) {
    output[metric.metricId] = metric.value
  }
  return output
}

const createMetricsHistory = (
  metrics: ReadonlyArray<MetricPoint>,
): Record<string, ReadonlyArray<MetricPoint>> =>
  metrics.reduce<Record<string, ReadonlyArray<MetricPoint>>>((acc, metric) => {
    const current = acc[metric.metricId] ?? []
    acc[metric.metricId] = [...current, metric]
    return acc
  }, {})

const pickInitialEntity = (
  screens: ReadonlyArray<PluginUiScreen>,
  entities: ReadonlyArray<EntitySnapshot>,
): EntitySnapshot | null => {
  const firstPrimary = screens.find((screen) => screen.kind !== "entity-detail") ?? screens[0]
  if (firstPrimary?.entityKind !== undefined) {
    return entities.find((entity) => entity.ref.kind === firstPrimary.entityKind) ?? null
  }
  return entities[0] ?? null
}

const setSelectedEntityState = (store: StateStore, entity: EntitySnapshot | null) => {
  store.set("/selectedEntity", entity ?? undefined)
  store.set("/ui/selectedEntityRef", entity?.ref)
}

const getSelectedEntityForProps = (
  state: PluginRouteState,
  path?: string,
): EntitySnapshot | null => {
  if (path === undefined) {
    return state.selectedEntity ?? null
  }

  const candidate = getByStatePath(state, path)
  if (
    candidate !== null
    && candidate !== undefined
    && typeof candidate === "object"
    && "ref" in (candidate as Record<string, unknown>)
  ) {
    return candidate as EntitySnapshot
  }

  return resolveEntityFromRef(state.entities, candidate as EntityRef | undefined)
}

const resolveLogTargetEntity = (
  selectedEntity: EntitySnapshot | null,
  entities: ReadonlyArray<EntitySnapshot>,
  stream: PluginStreamMetadata | undefined,
  fallbackTargetKinds?: ReadonlyArray<string>,
  relationshipTypes?: ReadonlyArray<string>,
): EntitySnapshot | null => {
  if (selectedEntity === null) {
    return null
  }

  const targetKinds = stream?.targetKinds ?? fallbackTargetKinds ?? []
  if (targetKinds.length === 0 || targetKinds.includes(selectedEntity.ref.kind)) {
    return selectedEntity
  }

  const relationships = (selectedEntity.relationships ?? []) as ReadonlyArray<EntityRelationship>
  for (const relationship of relationships) {
    if (
      relationshipTypes !== undefined
      && relationshipTypes.length > 0
      && !relationshipTypes.includes(relationship.type)
    ) {
      continue
    }
    if (!targetKinds.includes(relationship.target.kind)) {
      continue
    }
    const related = entities.find((entity) => entityRefEqual(entity.ref, relationship.target))
    if (related !== undefined) {
      return related
    }
  }

  return null
}

const buildInitialActionValues = (input: PluginInputMetadata): Record<string, unknown> => {
  if (input.kind !== "struct") {
    return {}
  }

  return Object.fromEntries(
    input.fields.map((field) => {
      switch (field.kind) {
        case "string":
          return [field.name, ""]
        case "number":
          return [field.name, ""]
        case "boolean":
          return [field.name, false]
        case "enum":
          return [field.name, field.options?.[0]?.value ?? ""]
      }
    }),
  )
}

const normalizeActionInput = (
  input: PluginInputMetadata,
  values: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  if (input.kind === "none") {
    return undefined
  }

  if (input.kind !== "struct") {
    return undefined
  }

  const output: Record<string, unknown> = {}

  for (const field of input.fields) {
    const raw = values[field.name]
    switch (field.kind) {
      case "string": {
        const value = typeof raw === "string" ? raw : ""
        if (value.trim().length === 0) {
          if (field.required) throw new Error(`${field.label} is required`)
          continue
        }
        output[field.name] = value
        break
      }
      case "number": {
        const text =
          typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : ""
        if (text.length === 0) {
          if (field.required) throw new Error(`${field.label} is required`)
          continue
        }
        const value = Number(text)
        if (!Number.isFinite(value)) {
          throw new Error(`${field.label} must be a valid number`)
        }
        output[field.name] = value
        break
      }
      case "boolean":
        output[field.name] = raw === true
        break
      case "enum": {
        const option = field.options?.find((candidate) => candidate.value === raw)
        if (option === undefined) {
          if (field.required) throw new Error(`${field.label} is required`)
          continue
        }
        output[field.name] = option.value
        break
      }
    }
  }

  return Object.keys(output).length > 0 ? output : undefined
}

const hasRenderableActionResult = (result: unknown): boolean => {
  if (result === null || result === undefined) {
    return false
  }
  if (typeof result === "object") {
    return Object.keys(result as Record<string, unknown>).length > 0
  }
  return true
}

const isUnitFileResult = (
  value: unknown,
): value is { readonly path: string; readonly content: string } =>
  value !== null
  && typeof value === "object"
  && typeof (value as Record<string, unknown>)["path"] === "string"
  && typeof (value as Record<string, unknown>)["content"] === "string"

function readDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

function resolveStatePathFromProps(props: { statePath?: string; bindState?: string }): string {
  return props.statePath ?? props.bindState ?? ""
}

function usePluginState(): PluginRouteState {
  const { state } = useStateStore()
  return state as unknown as PluginRouteState
}

const { registry } = defineRegistry(SCOUT_UI_CATALOG, {
  components: {
    Page: ({ props, children }) => (
      <div className="space-y-4">
        {props.title !== undefined || props.subtitle !== undefined || props.description !== undefined ? (
          <div className="space-y-1">
            {props.title !== undefined ? (
              <h2 className="text-lg font-semibold tracking-tight">{readDisplayValue(props.title)}</h2>
            ) : null}
            {props.subtitle !== undefined ? (
              <p className="text-sm text-muted-foreground">{readDisplayValue(props.subtitle)}</p>
            ) : null}
            {props.description !== undefined ? (
              <p className="text-sm text-muted-foreground">{readDisplayValue(props.description)}</p>
            ) : null}
          </div>
        ) : null}
        <div className="space-y-4">{children}</div>
      </div>
    ),
    Section: ({ props, children }) => (
      <div className="overflow-hidden rounded-lg border border-border">
        {props.title !== undefined || props.description !== undefined ? (
          <div className="border-b border-border px-4 py-3">
            {props.title !== undefined ? (
              <h3 className="text-sm font-medium">{readDisplayValue(props.title)}</h3>
            ) : null}
            {props.description !== undefined ? (
              <p className="mt-1 text-xs text-muted-foreground">{readDisplayValue(props.description)}</p>
            ) : null}
          </div>
        ) : null}
        <div className="p-4">{children}</div>
      </div>
    ),
    Grid: ({ props, children }) => (
      <div
        className={`grid ${
          props.columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : props.columns === 2 ? "sm:grid-cols-2" : "grid-cols-1"
        } ${
          props.gap === "sm" ? "gap-2" : props.gap === "lg" ? "gap-6" : "gap-4"
        }`}
      >
        {children}
      </div>
    ),
    Stack: ({ props, children }) => (
      <div
        className={[
          "flex",
          props.direction === "row" ? "flex-row flex-wrap items-center" : "flex-col",
          props.gap === "sm" ? "gap-2" : props.gap === "lg" ? "gap-6" : "gap-4",
          props.justify === "end"
            ? "justify-end"
            : props.justify === "center"
              ? "justify-center"
              : props.justify === "between"
                ? "justify-between"
                : "justify-start",
        ].join(" ")}
      >
        {children}
      </div>
    ),
    Text: ({ props }) => (
      <p
        className={
          props.tone === "muted"
            ? "text-sm text-muted-foreground"
            : props.tone === "danger"
              ? "text-sm text-destructive"
              : "text-sm"
        }
      >
        {readDisplayValue(props.text)}
      </p>
    ),
    Callout: ({ props }) => (
      <div
        className={
          props.tone === "warning"
            ? "rounded-md border border-warn/30 bg-warn/[0.06] px-3 py-2 text-sm"
            : props.tone === "danger"
              ? "rounded-md border border-err/30 bg-err/[0.06] px-3 py-2 text-sm"
              : "rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
        }
      >
        {readDisplayValue(props.text)}
      </div>
    ),
    StatGrid: ({ props }) => <StatGridComponent props={props as Record<string, unknown>} />,
    StatCard: ({ props }) => <StatCardComponent props={props as Record<string, unknown>} />,
    MetricStatCard: ({ props }) => <MetricStatCardComponent props={props as Record<string, unknown>} />,
    EntityTable: ({ props }) => <EntityTableComponent props={props as Record<string, unknown>} />,
    DetailList: ({ props }) => <DetailListComponent props={props as Record<string, unknown>} />,
    MetricChart: ({ props }) => <MetricChartComponent props={props as Record<string, unknown>} />,
    ActionBar: ({ props }) => <ActionBarComponent props={props as Record<string, unknown>} />,
    LogPanel: ({ props }) => <LogPanelComponent props={props as Record<string, unknown>} />,
    Form: ({ props, children }) => (
      <div className="rounded-lg border border-border p-4">
        {props.title !== undefined ? (
          <div className="mb-3 text-sm font-medium">{readDisplayValue(props.title)}</div>
        ) : null}
        <div className="space-y-4">{children}</div>
      </div>
    ),
    ActionButton: ({ props, emit }) => (
      <Button
        size="sm"
        variant={(props.variant ?? "default") as "default" | "outline" | "secondary" | "ghost" | "destructive"}
        onClick={() => emit("press")}
      >
        {readDisplayValue(props.label)}
      </Button>
    ),
    TextField: ({ props }) => <BoundTextField props={props as Record<string, unknown>} />,
    NumberField: ({ props }) => <BoundNumberField props={props as Record<string, unknown>} />,
    BooleanField: ({ props }) => <BoundBooleanField props={props as Record<string, unknown>} />,
    SelectField: ({ props }) => <BoundSelectField props={props as Record<string, unknown>} />,
    ResultPanel: ({ props }) => (
      <ResultPanelComponent
        resultStatePath={String(props.resultStatePath)}
        errorStatePath={String(props.errorStatePath)}
      />
    ),
  },
  actions: {
    "plugin.runAction": async () => {},
    "ui.selectEntity": async () => {},
    "ui.navigate": async () => {},
    "ui.closeActionForm": async () => {},
    "ui.showToast": async () => {},
    "ui.showActionResult": async () => {},
  },
})

function StatGridComponent(props: { readonly props: Record<string, unknown> }) {
  const state = usePluginState()
  const entity = getSelectedEntityForProps(
    state,
    typeof props.props["entityStatePath"] === "string" ? String(props.props["entityStatePath"]) : undefined,
  )
  const items = (props.props["items"] ?? props.props["metrics"] ?? []) as ReadonlyArray<PluginMetricRef>

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((metric) => {
        const latest = latestMetric(state.metrics, metric.metricId, entity)
        return (
          <div key={metric.id ?? metric.metricId} className="rounded-lg border border-border px-4 py-3">
            <div className="text-[12.5px] text-muted-foreground">
              {metric.label ?? metric.metricId}
            </div>
            <div className="mt-1.5 font-mono text-[22px] font-medium tabular">
              {latest ? formatMetricValue(latest.value, metric.unit ?? latest.unit) : "—"}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StatCardComponent(props: { readonly props: Record<string, unknown> }) {
  const state = usePluginState()
  const entity = getSelectedEntityForProps(
    state,
    typeof props.props["entityStatePath"] === "string" ? String(props.props["entityStatePath"]) : undefined,
  )
  const metricId = typeof props.props["metricId"] === "string" ? String(props.props["metricId"]) : undefined
  const label = readDisplayValue(props.props["label"])
  const tone =
    props.props["tone"] === "success"
      ? "text-ok"
      : props.props["tone"] === "danger"
        ? "text-err"
        : ""

  let value = props.props["value"]
  if (metricId !== undefined && (value === undefined || value === null)) {
    const latest = latestMetric(state.metrics, metricId, entity)
    value = latest === null ? "—" : formatMetricValue(latest.value, String(props.props["unit"] ?? latest.unit ?? ""))
  }

  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="text-[12.5px] text-muted-foreground">{label}</div>
      <div className={`mt-1.5 font-mono text-[22px] font-medium tabular ${tone}`}>{readDisplayValue(value)}</div>
    </div>
  )
}

function MetricStatCardComponent(props: { readonly props: Record<string, unknown> }) {
  return <StatCardComponent props={props.props} />
}

function EntityTableComponent(props: { readonly props: Record<string, unknown> }) {
  const state = usePluginState()
  const runtime = usePluginUiRuntime()
  const entityKind = String(props.props["entityKind"])
  const columns = (props.props["columns"] ?? []) as ReadonlyArray<PluginTableColumn>
  const rowActions = (props.props["rowActions"] ?? []) as ReadonlyArray<PluginActionItem>
  const entities =
    typeof props.props["statePath"] === "string"
      ? ((getByStatePath(state, String(props.props["statePath"])) as ReadonlyArray<EntitySnapshot> | undefined) ?? [])
      : state.entitiesByKind[entityKind] ?? []

  if (entities.length === 0) {
    const empty = props.props["empty"] as { title?: string; description?: string } | undefined
    return (
      <div className="text-sm text-muted-foreground">
        {empty?.title ?? "No entities found."}
        {empty?.description ? ` ${empty.description}` : ""}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.id}>{column.label}</TableHead>
          ))}
          {rowActions.length > 0 ? <TableHead className="w-12" aria-label="Actions" /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {entities.map((entity) => (
          <TableRow
            key={entity.ref.id}
            className="cursor-pointer"
            onClick={() => {
              runtime.selectEntity(entity)
              if (typeof props.props["detailScreenId"] === "string") {
                runtime.navigate(String(props.props["detailScreenId"]), entity)
              }
            }}
          >
            {columns.map((column) => {
              const value = resolveColumnValue(entity, column, state.metrics)
              return (
                <TableCell key={column.id}>
                  {column.presentation === "badge" ? (
                    <Badge variant="outline">{readDisplayValue(value)}</Badge>
                  ) : (
                    readDisplayValue(value)
                  )}
                </TableCell>
              )
            })}
            {rowActions.length > 0 ? (
              <TableCell className="w-12 text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        onClick={(event) => event.stopPropagation()}
                        className="inline-grid size-7 place-items-center rounded-md text-subtle hover:bg-muted hover:text-foreground"
                        aria-label={`Actions for ${entity.ref.id}`}
                      />
                    }
                  >
                    <span aria-hidden>⋯</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52" onClick={(event) => event.stopPropagation()}>
                    {rowActions.map((action) => {
                      const actionId = action.actionId ?? action.id
                      const metadata = state.plugin.agent?.actions.find((candidate) => candidate.id === actionId)
                      return (
                        <DropdownMenuItem
                          key={action.id ?? actionId}
                          onClick={() =>
                            void runtime.runAction({
                              action: metadata,
                              targetRef: entity.ref,
                            })
                          }
                        >
                          {action.label ?? metadata?.displayName ?? actionId}…
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function DetailListComponent(props: { readonly props: Record<string, unknown> }) {
  const state = usePluginState()
  const entity = getSelectedEntityForProps(
    state,
    typeof props.props["entityStatePath"] === "string" ? String(props.props["entityStatePath"]) : undefined,
  )
  const items = props.props["items"] as ReadonlyArray<{ label: string; value: unknown; presentation?: "badge" }> | undefined
  const fields = props.props["fields"] as ReadonlyArray<PluginTableColumn> | undefined

  if (items === undefined && entity === null) {
    return <div className="text-sm text-muted-foreground">Select an entity to inspect.</div>
  }

  const renderItems =
    items
    ?? (fields ?? []).map((field) => ({
      label: field.label,
      value: entity === null ? undefined : resolveColumnValue(entity, field, state.metrics),
      presentation: field.presentation,
    }))

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {renderItems.map((item, index) => (
        <div key={`${item.label}:${index}`} className="rounded-lg border border-border px-4 py-3">
          <div className="text-[12.5px] text-subtle">
            {item.label}
          </div>
          <div className="mt-2 text-sm">
            {item.presentation === "badge" ? (
              <Badge variant="outline">{readDisplayValue(item.value)}</Badge>
            ) : (
              readDisplayValue(item.value)
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function MetricChartComponent(props: { readonly props: Record<string, unknown> }) {
  const state = usePluginState()
  const entity = getSelectedEntityForProps(
    state,
    typeof props.props["entityStatePath"] === "string" ? String(props.props["entityStatePath"]) : undefined,
  )

  const metricRefs: ReadonlyArray<PluginMetricRef> =
    Array.isArray(props.props["metrics"])
      ? (props.props["metrics"] as ReadonlyArray<PluginMetricRef>)
      : Array.isArray(props.props["series"])
        ? (props.props["series"] as ReadonlyArray<PluginMetricRef>)
      : typeof props.props["metricId"] === "string"
        ? [
            {
              metricId: String(props.props["metricId"]),
              label: typeof props.props["title"] === "string" ? String(props.props["title"]) : String(props.props["metricId"]),
              unit: typeof props.props["unit"] === "string" ? String(props.props["unit"]) : undefined,
            },
          ]
        : []

  const chartData = buildTimeseries(state.metrics, metricRefs, entity)
  if (chartData.length === 0) {
    return <div className="text-sm text-muted-foreground">No metric history yet.</div>
  }

  return (
    <MetricsChart
      data={chartData}
      dataKeys={metricRefs.map((metric, index) => ({
        key: metric.metricId,
        label: metric.label ?? metric.metricId,
        color: CHART_COLORS[index % CHART_COLORS.length]!,
      }))}
      unit={normalizeChartUnit(metricRefs)}
      type="line"
      height={220}
    />
  )
}

function ActionBarComponent(props: { readonly props: Record<string, unknown> }) {
  const state = usePluginState()
  const runtime = usePluginUiRuntime()
  const entity = getSelectedEntityForProps(
    state,
    typeof props.props["entityStatePath"] === "string" ? String(props.props["entityStatePath"]) : undefined,
  )
  const actions = (props.props["actions"] ?? []) as ReadonlyArray<PluginActionItem>

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => {
        const actionId = action.actionId ?? action.id
        const binding = action.action
        const resolvedActionId =
          typeof binding?.params?.["actionId"] === "string"
            ? String(binding.params["actionId"])
            : actionId
        const metadata = state.plugin.agent?.actions.find((candidate) => candidate.id === resolvedActionId)
        return (
          <Button
            key={action.id ?? resolvedActionId}
            size="sm"
            variant={(action.variant ?? "outline") as "default" | "outline" | "secondary" | "ghost" | "destructive"}
            onClick={async () => {
              const bindingTarget =
                binding?.params?.["target"] !== null && typeof binding?.params?.["target"] === "object"
                  ? (binding?.params?.["target"] as { entityRef?: EntityRef })
                  : undefined
              await runtime.runAction({
                action: metadata,
                targetRef:
                  bindingTarget?.entityRef
                  ?? (binding?.params?.["entityRef"] as EntityRef | undefined)
                  ?? entity?.ref,
                explicitInput: binding?.params?.["input"] as Record<string, unknown> | undefined,
                ...(binding?.confirm !== undefined && { confirmCopy: binding.confirm }),
              })
            }}
          >
            {action.label ?? metadata?.displayName ?? resolvedActionId}
          </Button>
        )
      })}
    </div>
  )
}

function LogPanelComponent(props: { readonly props: Record<string, unknown> }) {
  const state = usePluginState()
  const streamId = String(props.props["streamId"])
  const stream = state.plugin.agent?.streams.find((candidate) => candidate.id === streamId)

  const targetProp =
    props.props["target"] !== null && typeof props.props["target"] === "object"
      ? (props.props["target"] as { entityRef?: EntityRef })
      : undefined
  const explicitEntity = getSelectedEntityForProps(
    state,
    typeof props.props["targetEntityStatePath"] === "string"
      ? String(props.props["targetEntityStatePath"])
      : typeof props.props["entityStatePath"] === "string"
        ? String(props.props["entityStatePath"])
        : undefined,
  ) ?? resolveEntityFromRef(state.entities, targetProp?.entityRef)

  const fallbackKinds = Array.isArray(props.props["fallbackTargetKinds"])
    ? (props.props["fallbackTargetKinds"] as ReadonlyArray<string>)
    : undefined
  const relationshipTypes = Array.isArray(props.props["relationshipTypes"])
    ? (props.props["relationshipTypes"] as ReadonlyArray<string>)
    : undefined

  const target = resolveLogTargetEntity(
    explicitEntity,
    state.entities,
    stream,
    fallbackKinds,
    relationshipTypes,
  )

  const [closed, setClosed] = useState(false)

  if (stream === undefined) {
    return <div className="text-sm text-muted-foreground">This log stream is not available.</div>
  }
  if (explicitEntity === null) {
    return <div className="text-sm text-muted-foreground">Select an entity to stream logs.</div>
  }
  if (target === null) {
    return (
      <div className="text-sm text-muted-foreground">
        No compatible log target is available for this stream.
      </div>
    )
  }
  if (closed) {
    return (
      <Button size="sm" variant="outline" onClick={() => setClosed(false)}>
        Reopen Logs
      </Button>
    )
  }

  const inputFromState =
    typeof props.props["statePath"] === "string"
      ? ((getByStatePath(state, String(props.props["statePath"])) as Record<string, unknown> | undefined) ?? {})
      : undefined
  const input =
    inputFromState
    ?? (props.props["input"] !== null && typeof props.props["input"] === "object"
      ? (props.props["input"] as Record<string, unknown>)
      : {})
  const tail =
    typeof props.props["tail"] === "number"
      ? Number(props.props["tail"])
      : typeof input["tail"] === "number"
        ? Number(input["tail"])
        : 200

  return (
    <div className="h-[420px] overflow-hidden rounded-lg border border-border">
      <LogViewer
        params={{
          agentId: String(state.system["id"] ?? ""),
          pluginId: state.plugin.manifest.id,
          streamId,
          entity: {
            pluginId: target.ref.pluginId,
            kind: target.ref.kind,
            id: target.ref.id,
          },
          input: { tail },
        }}
        onClose={() => setClosed(true)}
      />
    </div>
  )
}

function BoundTextField(props: { readonly props: Record<string, unknown> }) {
  const { get, set } = useStateStore()
  const statePath = resolveStatePathFromProps(props.props as { statePath?: string; bindState?: string })
  const value = statePath.length > 0 ? get(statePath) : undefined
  return (
    <div className="space-y-2">
      <Label>{readDisplayValue(props.props["label"])}</Label>
      {props.props["multiline"] === true ? (
        <Textarea
          value={typeof value === "string" ? value : ""}
          placeholder={typeof props.props["placeholder"] === "string" ? String(props.props["placeholder"]) : undefined}
          className="min-h-32"
          onChange={(event) => set(statePath, event.target.value)}
        />
      ) : (
        <Input
          value={typeof value === "string" ? value : ""}
          placeholder={typeof props.props["placeholder"] === "string" ? String(props.props["placeholder"]) : undefined}
          onChange={(event) => set(statePath, event.target.value)}
        />
      )}
    </div>
  )
}

function BoundNumberField(props: { readonly props: Record<string, unknown> }) {
  const { get, set } = useStateStore()
  const statePath = resolveStatePathFromProps(props.props as { statePath?: string; bindState?: string })
  const value = statePath.length > 0 ? get(statePath) : undefined
  return (
    <div className="space-y-2">
      <Label>{readDisplayValue(props.props["label"])}</Label>
      <Input
        type="number"
        min={typeof props.props["min"] === "number" ? Number(props.props["min"]) : undefined}
        max={typeof props.props["max"] === "number" ? Number(props.props["max"]) : undefined}
        value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
        onChange={(event) => set(statePath, event.target.value)}
      />
    </div>
  )
}

function BoundBooleanField(props: { readonly props: Record<string, unknown> }) {
  const { get, set } = useStateStore()
  const statePath = resolveStatePathFromProps(props.props as { statePath?: string; bindState?: string })
  const value = statePath.length > 0 ? get(statePath) : undefined
  return (
    <div className="flex items-center gap-3">
      <Switch checked={value === true} onCheckedChange={(checked) => set(statePath, checked)} />
      <span className="text-sm">{readDisplayValue(props.props["label"])}</span>
    </div>
  )
}

function BoundSelectField(props: { readonly props: Record<string, unknown> }) {
  const { get, set } = useStateStore()
  const statePath = resolveStatePathFromProps(props.props as { statePath?: string; bindState?: string })
  const value = statePath.length > 0 ? get(statePath) : undefined
  const options = (props.props["options"] ?? []) as ReadonlyArray<{
    readonly label: string
    readonly value: string | number | boolean
  }>

  return (
    <div className="space-y-2">
      <Label>{readDisplayValue(props.props["label"])}</Label>
      <NativeSelect
        value={value !== undefined ? String(value) : ""}
        onChange={(event) => {
          const option = options.find((candidate) => String(candidate.value) === event.target.value)
          set(statePath, option?.value ?? event.target.value)
        }}
        className="w-full"
      >
        {options.map((option) => (
          <NativeSelectOption key={String(option.value)} value={String(option.value)}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}

function ResultPanelComponent(props: {
  readonly resultStatePath: string
  readonly errorStatePath: string
}) {
  const { get } = useStateStore()
  const error = get(props.errorStatePath)
  const result = get(props.resultStatePath)

  if (typeof error === "string" && error.length > 0) {
    return (
      <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {error}
      </div>
    )
  }

  if (result === undefined || result === null) {
    return null
  }

  if (isUnitFileResult(result)) {
    return (
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">{result.path}</div>
        <Textarea value={result.content} readOnly className="min-h-64 font-mono text-[11px]" />
      </div>
    )
  }

  return (
    <pre className="overflow-x-auto rounded border border-border bg-muted/30 p-3 text-[11px]">
      {JSON.stringify(result, null, 2)}
    </pre>
  )
}

function buildFormFieldElement(field: PluginFormFieldMetadata): PluginUiSpec["elements"][string] {
  const bindState = `/ui/actionForm/values/${field.name}`
  switch (field.kind) {
    case "string":
      return {
        type: "TextField",
        props: {
          label: field.required ? field.label : `${field.label} (optional)`,
          bindState,
          ...(field.multiline && { multiline: true }),
        },
      }
    case "number":
      return {
        type: "NumberField",
        props: {
          label: field.required ? field.label : `${field.label} (optional)`,
          bindState,
        },
      }
    case "boolean":
      return {
        type: "BooleanField",
        props: {
          label: field.label,
          bindState,
        },
      }
    case "enum":
      return {
        type: "SelectField",
        props: {
          label: field.required ? field.label : `${field.label} (optional)`,
          bindState,
          options: field.options ?? [],
        },
      }
  }
}

function buildFormSpec(action: PluginActionMetadata, targetRef?: EntityRef): PluginUiSpec {
  const fieldKeys = action.input.kind === "struct"
    ? action.input.fields.map((field) => `${field.name}-field`)
    : []

  const elements: PluginUiSpec["elements"] = {
    root: {
      type: "Stack",
      props: { gap: "md" },
      children: [
        "description",
        ...(action.input.kind === "unsupported" ? ["unsupported"] : fieldKeys),
        "result",
        "actions",
      ],
    },
    description: {
      type: "Text",
      props: {
        text: targetRef !== undefined
          ? `${action.displayName} — target ${targetRef.id}`
          : action.description ?? "Node-scoped action",
        tone: "muted",
      },
    },
    ...(action.input.kind === "unsupported"
      ? {
          unsupported: {
            type: "Callout",
            props: {
              tone: "danger",
              text: action.input.reason,
            },
          },
        }
      : {}),
    ...Object.fromEntries(
      action.input.kind !== "struct"
        ? []
        : action.input.fields.map((field) => [
            `${field.name}-field`,
            buildFormFieldElement(field),
          ]),
    ),
    result: {
      type: "ResultPanel",
      props: {
        resultStatePath: "/ui/actionResult",
        errorStatePath: "/ui/actionError",
      },
    },
    actions: {
      type: "Stack",
      props: {
        direction: "row",
        gap: "sm",
        justify: "end",
      },
      children: ["cancel", "submit"],
    },
    cancel: {
      type: "ActionButton",
      props: {
        label: "Close",
        variant: "outline",
      },
      on: {
        press: {
          action: "ui.closeActionForm",
        },
      },
    },
    submit: {
      type: "ActionButton",
      props: {
        label: "Run Action",
      },
      on: {
        press: {
          action: "plugin.runAction",
          ...(action.requiresConfirmation && {
            confirm: {
              title: action.displayName,
              message: `Run ${action.displayName.toLowerCase()}?`,
              confirmLabel: "Run",
              variant: "danger",
            },
          }),
          params: {
            actionId: action.id,
            ...(targetRef !== undefined && {
              target: {
                entityRef: targetRef,
              },
            }),
            ...(action.input.kind === "struct" && {
              inputStatePath: "/ui/actionForm/values",
            }),
            closeFormOnSuccess: true,
          },
        },
      },
    },
  }

  return {
    root: "root",
    elements,
  }
}

function createRuntimeActions(args: {
  readonly store: StateStore
  readonly confirm: (options: ConfirmOptions) => Promise<boolean>
  readonly runAction: (input: {
    readonly payload: {
      readonly agentId: string
      readonly pluginId: string
      readonly actionId: string
      readonly entity?: {
        readonly pluginId: string
        readonly kind: string
        readonly id: string
      }
      readonly input?: Record<string, unknown>
    }
  }) => Promise<{ readonly output?: unknown }>
}): PluginUiRuntimeActions {
  const { store } = args

  return {
    selectEntity: (entity) => {
      setSelectedEntityState(store, entity)
    },
    navigate: (screenId, entity) => {
      const state = store.getSnapshot() as unknown as PluginRouteState
      const screen = state.plugin.web?.screens.find((candidate) => candidate.id === screenId)
      if (entity !== undefined) {
        setSelectedEntityState(store, entity)
      }
      if (screen?.kind === "entity-detail") {
        store.set("/ui/activeDetailScreenId", screen.id)
        return
      }
      store.set("/ui/activePrimaryScreenId", screenId)
      if (screen?.entityKind !== undefined) {
        const nextEntity = state.entities.find((candidate) => candidate.ref.kind === screen.entityKind) ?? null
        setSelectedEntityState(store, nextEntity)
      }
    },
    runAction: async ({ action, targetRef, explicitInput, inputStatePath, closeFormOnSuccess, confirmCopy }) => {
      const state = store.getSnapshot() as unknown as PluginRouteState
      if (action === undefined) {
        toast.error("Unknown plugin action")
        return
      }

      const rawFormInput =
        inputStatePath !== undefined
          ? (getByStatePath(store.getSnapshot(), inputStatePath) as Record<string, unknown> | undefined)
          : undefined

      if (explicitInput === undefined && inputStatePath === undefined && action.input.kind === "struct") {
        store.set("/ui/actionResult", undefined)
        store.set("/ui/actionError", undefined)
        store.set("/ui/actionForm", {
          actionId: action.id,
          ...(targetRef !== undefined && { targetRef }),
          values: buildInitialActionValues(action.input),
          openedAt: Date.now(),
        })
        return
      }

      if (action.input.kind === "unsupported") {
        store.set("/ui/actionResult", undefined)
        store.set("/ui/actionError", action.input.reason)
        store.set("/ui/actionForm", {
          actionId: action.id,
          ...(targetRef !== undefined && { targetRef }),
          values: {},
          openedAt: Date.now(),
        })
        return
      }

      const input =
        explicitInput
        ?? normalizeActionInput(action.input, rawFormInput ?? {})

      // Every plugin action runs behind the app's confirm dialog.
      const machine = String(state.system["hostname"] ?? state.system["id"] ?? "this machine")
      // The title always names the action, its target, and the machine; a screen's
      // own confirm copy supplies the explanation and button label.
      const approved = await args.confirm({
        title: `${action.displayName}${targetRef ? ` ${targetRef.id}` : ""} on ${machine}?`,
        description:
          confirmCopy?.message ??
          `${action.description ?? `Runs the ${state.plugin.manifest.displayName} plugin's ${action.displayName.toLowerCase()} action.`} Scout records this action in the hub audit log under your identity.`,
        confirmLabel: confirmCopy?.confirmLabel ?? action.displayName,
        destructive: confirmCopy?.variant === "danger" || action.requiresConfirmation,
      })
      if (!approved) {
        return
      }

      try {
        const result = await args.runAction({
          payload: {
            agentId: String(state.system["id"] ?? ""),
            pluginId: state.plugin.manifest.id,
            actionId: action.id,
            ...(targetRef !== undefined && {
              entity: {
                pluginId: targetRef.pluginId,
                kind: targetRef.kind,
                id: targetRef.id,
              },
            }),
            ...(input !== undefined && { input }),
          },
        })

        const output = result.output
        store.set("/ui/actionError", undefined)
      if (hasRenderableActionResult(output)) {
        store.set("/ui/actionResult", output)
        const existingForm = getByStatePath(store.getSnapshot(), "/ui/actionForm")
          if (existingForm === undefined) {
            store.set("/ui/actionForm", {
              actionId: action.id,
              ...(targetRef !== undefined && { targetRef }),
              values: buildInitialActionValues(action.input),
              openedAt: Date.now(),
            })
          }
        } else {
          store.set("/ui/actionResult", undefined)
          toast.success(`Executed ${action.displayName}`)
        }

        if (closeFormOnSuccess && !hasRenderableActionResult(output)) {
          store.set("/ui/actionForm", undefined)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : `Failed to execute ${action.displayName}`
        store.set("/ui/actionError", message)
        toast.error(message)
      }
    },
  }
}

function createHandlers(args: {
  readonly store: StateStore
  readonly runtime: PluginUiRuntimeActions
}): Record<string, (params?: Record<string, unknown>) => Promise<void>> {
  const { store, runtime } = args

  return {
    "plugin.runAction": async (params) => {
      const state = store.getSnapshot() as unknown as PluginRouteState
      const actionId = typeof params?.["actionId"] === "string" ? String(params["actionId"]) : ""
      const action = state.plugin.agent?.actions.find((candidate) => candidate.id === actionId)
      const target =
        params?.["target"] !== null && typeof params?.["target"] === "object"
          ? (params?.["target"] as { entityRef?: EntityRef })
          : undefined
      await runtime.runAction({
        action,
        targetRef:
          target?.entityRef
          ?? (params?.["entityRef"] as EntityRef | undefined)
          ?? (params?.["targetRef"] as EntityRef | undefined),
        explicitInput: params?.["input"] as Record<string, unknown> | undefined,
        inputStatePath: params?.["inputStatePath"] as string | undefined,
        closeFormOnSuccess: params?.["closeFormOnSuccess"] === true,
      })
    },
    "ui.selectEntity": async (params) => {
      const state = store.getSnapshot() as unknown as PluginRouteState
      const ref = params?.["entityRef"] as EntityRef | undefined
      runtime.selectEntity(resolveEntityFromRef(state.entities, ref))
    },
    "ui.navigate": async (params) => {
      if (typeof params?.["screenId"] !== "string") {
        return
      }
      const state = store.getSnapshot() as unknown as PluginRouteState
      const ref = params?.["entityRef"] as EntityRef | undefined
      runtime.navigate(
        String(params["screenId"]),
        ref === undefined ? undefined : resolveEntityFromRef(state.entities, ref),
      )
    },
    "ui.closeActionForm": async () => {
      store.set("/ui/actionForm", undefined)
      store.set("/ui/actionError", undefined)
    },
    "ui.showToast": async (params) => {
      const message =
        typeof params?.["message"] === "string"
          ? String(params["message"])
          : "Action completed"
      if (params?.["variant"] === "error") {
        toast.error(message)
      } else {
        toast.success(message)
      }
    },
    "ui.showActionResult": async () => {
      // `plugin.runAction` already stores renderable output in `/ui/actionResult`.
    },
  }
}

export function buildPluginRouteInitialState(
  system: Record<string, unknown>,
  plugin: PluginDetailResponse,
  entities: ReadonlyArray<EntitySnapshot>,
  metrics: ReadonlyArray<MetricPoint>,
  events: ReadonlyArray<EventRecord> = [],
): PluginRouteState {
  const screens = plugin.web?.screens ?? []
  const selectedEntity = pickInitialEntity(screens, entities)
  const primaryScreens = screens.filter((screen) => screen.kind !== "entity-detail")
  const mergedScreenState = screens.reduce<Record<string, unknown>>(
    (acc, screen) => deepMerge(acc, screen.spec.state ?? {}),
    {},
  )

  const baseState: PluginRouteState = {
    system,
    plugin,
    entities,
    metrics,
    events,
    entitiesByKind: createEntitiesByKind(entities),
    metricsLatest: createMetricsLatest(metrics),
    metricsHistory: createMetricsHistory(metrics),
    ...(selectedEntity !== null && { selectedEntity }),
    ui: {
      activePrimaryScreenId: primaryScreens[0]?.id ?? screens[0]?.id ?? null,
      ...(selectedEntity !== null && { selectedEntityRef: selectedEntity.ref }),
    },
  }

  return deepMerge(baseState as unknown as Record<string, unknown>, mergedScreenState) as unknown as PluginRouteState
}

export function createPluginRouteStore(initialState: PluginRouteState) {
  return createStateStore(initialState as unknown as Record<string, unknown>)
}

export function usePluginRouteStoreValue(
  store: StateStore | null,
  selector: (state: PluginRouteState) => PluginRouteState | null,
): PluginRouteState | null {
  const noop = useMemo(() => () => () => {}, [])
  const getSnapshot = store !== null
    ? () => selector(store.getSnapshot() as unknown as PluginRouteState)
    : () => null
  const getServerSnapshot = store !== null && store.getServerSnapshot
    ? () => selector(store.getServerSnapshot!() as unknown as PluginRouteState)
    : getSnapshot
  return useSyncExternalStore(
    store?.subscribe ?? noop,
    getSnapshot,
    getServerSnapshot,
  )
}

export function getPrimaryScreens(plugin: PluginDetailResponse): ReadonlyArray<PluginUiScreen> {
  return (plugin.web?.screens ?? []).filter((screen) => screen.kind !== "entity-detail")
}

export function getActivePrimaryScreen(
  plugin: PluginDetailResponse,
  activePrimaryScreenId: string | null,
): PluginUiScreen | null {
  const primaryScreens = getPrimaryScreens(plugin)
  return (
    primaryScreens.find((screen) => screen.id === activePrimaryScreenId)
    ?? primaryScreens[0]
    ?? plugin.web?.screens?.[0]
    ?? null
  )
}

export function getSelectedEntity(state: PluginRouteState): EntitySnapshot | null {
  return state.selectedEntity
    ?? resolveEntityFromRef(state.entities, state.ui.selectedEntityRef)
}

export function getDetailScreen(
  plugin: PluginDetailResponse,
  selectedEntity: EntitySnapshot | null,
  activeDetailScreenId?: string | null,
): PluginUiScreen | null {
  if (selectedEntity === null) {
    return null
  }

  const matchingScreens = (plugin.web?.screens ?? []).filter(
    (screen) =>
      screen.kind === "entity-detail"
      && screen.entityKind === selectedEntity.ref.kind,
  )

  return (
    matchingScreens.find((screen) => screen.id === activeDetailScreenId)
    ?? matchingScreens[0]
    ?? null
  )
}

export function createActionFormSpec(
  plugin: PluginDetailResponse,
  actionForm: PluginRouteState["ui"]["actionForm"],
): PluginUiSpec | null {
  if (actionForm === undefined) {
    return null
  }
  const action = plugin.agent?.actions.find((candidate) => candidate.id === actionForm.actionId)
  if (action === undefined) {
    return null
  }
  return buildFormSpec(action, actionForm.targetRef)
}

export function PluginUiRenderer(props: {
  readonly store: StateStore
  readonly spec: PluginUiSpec
  readonly runAction: (input: {
    readonly payload: {
      readonly agentId: string
      readonly pluginId: string
      readonly actionId: string
      readonly entity?: {
        readonly pluginId: string
        readonly kind: string
        readonly id: string
      }
      readonly input?: Record<string, unknown>
    }
  }) => Promise<{ readonly output?: unknown }>
}) {
  const confirm = useConfirm()
  const runtime = useMemo(
    () =>
      createRuntimeActions({
        store: props.store,
        confirm,
        runAction: props.runAction,
      }),
    [confirm, props.runAction, props.store],
  )
  const handlers = useMemo(
    () =>
      createHandlers({
        store: props.store,
        runtime,
      }),
    [props.store, runtime],
  )

  return (
      <PluginUiRuntimeContext.Provider value={runtime}>
      <JSONUIProvider registry={registry} store={props.store} handlers={handlers}>
        <Renderer spec={props.spec as any} registry={registry} />
      </JSONUIProvider>
    </PluginUiRuntimeContext.Provider>
  )
}
