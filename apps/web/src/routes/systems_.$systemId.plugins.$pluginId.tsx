import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useAtomSet } from "@effect/atom-react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MetricsChart } from "@/components/charts/metrics-chart"
import { LogViewer } from "@/components/log-viewer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { fetchSystemDetail } from "@/server/systems"
import { fetchPluginDetail, fetchPluginEntities, fetchPluginMetrics } from "@/server/plugins"
import { HubClient } from "@/rpc/client"

interface EntitySnapshot {
  readonly ref: {
    readonly pluginId: string
    readonly kind: string
    readonly nodeId: string
    readonly id: string
  }
  readonly ts: number
  readonly displayName?: string
  readonly status?: string
  readonly labels?: Record<string, string>
  readonly spec?: unknown
  readonly state?: unknown
  readonly relationships?: ReadonlyArray<unknown>
}

interface MetricPoint {
  readonly pluginId: string
  readonly metricId: string
  readonly ts: number
  readonly entity?: {
    readonly pluginId: string
    readonly kind: string
    readonly nodeId: string
    readonly id: string
  }
  readonly value: number
  readonly unit?: string
  readonly tags?: Record<string, string>
}

type ViewColumn =
  | {
      readonly id: string
      readonly label: string
      readonly source: { readonly _tag: "field"; readonly path: string }
    }
  | {
      readonly id: string
      readonly label: string
      readonly source: { readonly _tag: "label"; readonly key: string }
    }
  | {
      readonly id: string
      readonly label: string
      readonly source: { readonly _tag: "status" }
    }
  | {
      readonly id: string
      readonly label: string
      readonly source: { readonly _tag: "metric"; readonly metricId: string }
    }

interface ViewMetricRef {
  readonly metricId: string
  readonly label?: string
  readonly unit?: string
}

interface PluginFormOptionMetadata {
  readonly label: string
  readonly value: string | number | boolean
}

interface PluginFormFieldMetadata {
  readonly name: string
  readonly label: string
  readonly kind: "string" | "number" | "boolean" | "enum"
  readonly required: boolean
  readonly multiline?: boolean
  readonly options?: ReadonlyArray<PluginFormOptionMetadata>
}

type PluginInputMetadata =
  | { readonly kind: "none" }
  | { readonly kind: "struct"; readonly fields: ReadonlyArray<PluginFormFieldMetadata> }
  | { readonly kind: "unsupported"; readonly reason: string }

interface PluginActionMetadata {
  readonly id: string
  readonly displayName: string
  readonly description?: string
  readonly requiresConfirmation: boolean
  readonly targetKinds: ReadonlyArray<string>
  readonly input: PluginInputMetadata
}

interface PluginStreamMetadata {
  readonly id: string
  readonly displayName: string
  readonly description?: string
  readonly kind: string
  readonly targetKinds: ReadonlyArray<string>
  readonly input: PluginInputMetadata
}

type ViewSection =
  | {
      readonly _tag: "stat-grid"
      readonly title?: string
      readonly metrics: ReadonlyArray<ViewMetricRef>
    }
  | {
      readonly _tag: "timeseries"
      readonly title?: string
      readonly metrics: ReadonlyArray<ViewMetricRef>
    }
  | {
      readonly _tag: "entity-table"
      readonly title?: string
      readonly entityKind: string
      readonly columns: ReadonlyArray<ViewColumn>
      readonly actions?: ReadonlyArray<{ readonly actionId: string; readonly label?: string }>
    }
  | {
      readonly _tag: "detail"
      readonly title?: string
      readonly fields: ReadonlyArray<ViewColumn>
    }
  | {
      readonly _tag: "actions"
      readonly title?: string
      readonly actions: ReadonlyArray<{ readonly actionId: string; readonly label?: string }>
    }
  | {
      readonly _tag: "logs"
      readonly title?: string
      readonly streamId: string
    }

interface ViewDefinition {
  readonly id: string
  readonly pluginId: string
  readonly kind: "dashboard" | "list" | "detail"
  readonly title: string
  readonly entityKind?: string
  readonly sections: ReadonlyArray<ViewSection>
}

interface EntityRelationship {
  readonly type: string
  readonly target: {
    readonly pluginId: string
    readonly kind: string
    readonly nodeId: string
    readonly id: string
  }
}

export const Route = createFileRoute("/systems_/$systemId/plugins/$pluginId")({
  loader: async ({ params }) => {
    const [system, plugin, entities, metrics] = await Promise.all([
      fetchSystemDetail({ data: { systemId: params.systemId } }),
      fetchPluginDetail({ data: { pluginId: params.pluginId } }),
      fetchPluginEntities({ data: { systemId: params.systemId, pluginId: params.pluginId } }),
      fetchPluginMetrics({ data: { systemId: params.systemId, pluginId: params.pluginId, hours: 24 } }),
    ])

    return {
      system,
      plugin: plugin as {
        readonly manifest: {
        readonly id: string
        readonly displayName: string
        readonly version: string
      }
      readonly agent?: {
        readonly actions: ReadonlyArray<PluginActionMetadata>
        readonly streams: ReadonlyArray<PluginStreamMetadata>
      }
      readonly web?: {
        readonly views: ReadonlyArray<ViewDefinition>
      }
      } | null,
      entities: entities as ReadonlyArray<EntitySnapshot>,
      metrics: metrics as ReadonlyArray<MetricPoint>,
    }
  },
  component: PluginSystemPage,
})

function PluginSystemPage() {
  const { systemId, pluginId } = Route.useParams()
  const { system, plugin, entities, metrics } = Route.useLoaderData()
  const runAction = useAtomSet(HubClient.mutation("plugins.runAction"), { mode: "promise" })
  const [logRequest, setLogRequest] = useState<{
    streamId: string
    entity?: EntitySnapshot
  } | null>(null)
  const [actionRequest, setActionRequest] = useState<{
    action: PluginActionMetadata
    entity?: EntitySnapshot
  } | null>(null)
  const [actionValues, setActionValues] = useState<Record<string, unknown>>({})
  const [actionResult, setActionResult] = useState<unknown>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const views = plugin?.web?.views ?? []
  const primaryViews = views.filter((view) => view.kind !== "detail")
  const actionDefinitions = new Map(
    (plugin?.agent?.actions ?? []).map((action) => [action.id, action] as const),
  )
  const streamDefinitions = new Map(
    (plugin?.agent?.streams ?? []).map((stream) => [stream.id, stream] as const),
  )
  const [activePrimaryViewId, setActivePrimaryViewId] = useState<string | null>(
    primaryViews[0]?.id ?? null,
  )
  const activePrimaryView =
    primaryViews.find((view) => view.id === activePrimaryViewId)
    ?? primaryViews[0]
    ?? views[0]
    ?? null
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(
    pickInitialEntityId(activePrimaryView, entities),
  )
  const selectedEntity = entities.find((entity) => entity.ref.id === selectedEntityId) ?? null
  const detailView =
    selectedEntity === null
      ? null
      : views.find(
          (view) => view.kind === "detail" && view.entityKind === selectedEntity.ref.kind,
        ) ?? null

  useEffect(() => {
    setActivePrimaryViewId(primaryViews[0]?.id ?? null)
  }, [pluginId, primaryViews])

  useEffect(() => {
    const nextEntityId = pickEntityIdForActiveView(activePrimaryView, selectedEntity, entities)
    if (nextEntityId !== selectedEntityId) {
      setSelectedEntityId(nextEntityId)
    }
  }, [activePrimaryView, entities, selectedEntity, selectedEntityId])

  if (system === null || plugin === null || activePrimaryView === null) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Plugin view not available.</p>
      </div>
    )
  }

  const openActionSheet = (action: PluginActionMetadata, entity?: EntitySnapshot) => {
    setActionRequest({ action, entity })
    setActionValues(buildInitialActionValues(action.input))
    setActionResult(null)
    setActionError(null)
  }

  const closeActionSheet = () => {
    setActionRequest(null)
    setActionValues({})
    setActionResult(null)
    setActionError(null)
    setActionLoading(false)
  }

  const executeAction = async (
    action: PluginActionMetadata,
    entity: EntitySnapshot | undefined,
    values: Record<string, unknown>,
    options?: { openResultSheet?: boolean },
  ) => {
    setActionLoading(true)
    setActionError(null)
    try {
      const input = normalizeActionInput(action.input, values)
      const result = await runAction({
        payload: {
          agentId: systemId,
          pluginId,
          actionId: action.id,
          ...(entity !== undefined && {
            entity: {
              pluginId,
              kind: entity.ref.kind,
              id: entity.ref.id,
            },
          }),
          ...(input !== undefined && { input }),
        },
      })

      const output = result.output
      if (hasRenderableActionResult(output)) {
        setActionResult(output)
        if (actionRequest === null && options?.openResultSheet === true) {
          openActionSheet(action, entity)
          setActionResult(output)
        }
      } else {
        toast.success(`Executed ${action.displayName}`)
        if (actionRequest !== null) {
          closeActionSheet()
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to execute ${action.displayName}`
      setActionError(message)
      if (actionRequest === null) {
        toast.error(message)
      }
    } finally {
      setActionLoading(false)
    }
  }

  const handleAction = async (actionId: string, entity?: EntitySnapshot) => {
    const action = actionDefinitions.get(actionId)
    if (action === undefined) {
      toast.error(`Unknown plugin action: ${actionId}`)
      return
    }

    const needsSheet =
      action.requiresConfirmation
      || action.input.kind === "struct"
      || action.input.kind === "unsupported"

    if (needsSheet) {
      openActionSheet(action, entity)
      return
    }

    await executeAction(action, entity, {}, { openResultSheet: true })
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <Link
            to="/systems/$systemId"
            params={{ systemId }}
            className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
            Back to system
          </Link>
          <h1 className="font-heading text-lg font-semibold">{plugin.manifest.displayName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{system.hostname}</span>
            <span>{plugin.manifest.id}</span>
            <span>v{plugin.manifest.version}</span>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {(system.pluginCapabilities ?? [])
            .filter((capability) => capability.pluginId === pluginId)
            .map((capability) => (
              <Badge key={capability.pluginId} variant="outline" className="text-[10px]">
                {capability.status}
              </Badge>
            ))}
        </div>
      </div>

      {primaryViews.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {primaryViews.map((view) => (
            <Button
              key={view.id}
              size="sm"
              variant={view.id === activePrimaryView.id ? "default" : "outline"}
              onClick={() => setActivePrimaryViewId(view.id)}
            >
              {view.title}
            </Button>
          ))}
        </div>
      )}

      <PluginViewSectionList
        systemId={systemId}
        pluginId={pluginId}
        view={activePrimaryView}
        entities={entities}
        metrics={metrics}
        selectedEntity={selectedEntity}
        streamDefinitions={streamDefinitions}
        onSelectEntity={setSelectedEntityId}
        onRunAction={handleAction}
        onOpenLogs={(streamId, entity) => setLogRequest({ streamId, entity })}
      />

      {detailView !== null && selectedEntity !== null && (
        <div className="mt-6">
          <PluginViewSectionList
            systemId={systemId}
            pluginId={pluginId}
            view={detailView}
            entities={entities}
            metrics={metrics}
            selectedEntity={selectedEntity}
            streamDefinitions={streamDefinitions}
            onSelectEntity={setSelectedEntityId}
            onRunAction={handleAction}
            onOpenLogs={(streamId, entity) => setLogRequest({ streamId, entity })}
          />
        </div>
      )}

      {logRequest !== null && (
        <div className="mt-6 h-[420px] overflow-hidden rounded border border-border">
          <LogViewer
            params={{
              agentId: systemId,
              pluginId,
              streamId: logRequest.streamId,
              ...(logRequest.entity !== undefined && {
                entity: {
                  pluginId,
                  kind: logRequest.entity.ref.kind,
                  id: logRequest.entity.ref.id,
                },
              }),
              input: { tail: 200 },
            }}
            onClose={() => setLogRequest(null)}
          />
        </div>
      )}

      <Sheet open={actionRequest !== null} onOpenChange={(open) => !open && closeActionSheet()}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0">
          {actionRequest !== null && (
            <PluginActionSheet
              action={actionRequest.action}
              entity={actionRequest.entity}
              values={actionValues}
              result={actionResult}
              error={actionError}
              loading={actionLoading}
              onClose={closeActionSheet}
              onChange={(name, value) =>
                setActionValues((current) => ({ ...current, [name]: value }))
              }
              onSubmit={async () =>
                executeAction(actionRequest.action, actionRequest.entity, actionValues)
              }
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

interface PluginViewSectionListProps {
  readonly systemId: string
  readonly pluginId: string
  readonly view: ViewDefinition
  readonly entities: ReadonlyArray<EntitySnapshot>
  readonly metrics: ReadonlyArray<MetricPoint>
  readonly selectedEntity: EntitySnapshot | null
  readonly streamDefinitions: ReadonlyMap<string, PluginStreamMetadata>
  readonly onSelectEntity: (entityId: string) => void
  readonly onRunAction: (actionId: string, entity?: EntitySnapshot) => Promise<void>
  readonly onOpenLogs: (streamId: string, entity?: EntitySnapshot) => void
}

function PluginViewSectionList(props: PluginViewSectionListProps) {
  return (
    <div className="space-y-4">
      {props.view.sections.map((section: ViewSection, index: number) => (
        <div key={`${props.view.id}:${index}`} className="rounded border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-heading text-sm font-semibold">{section.title ?? props.view.title}</h2>
          </div>
          <div className="p-4">
            <PluginSectionRenderer {...props} section={section} />
          </div>
        </div>
      ))}
    </div>
  )
}

function PluginSectionRenderer(
  props: PluginViewSectionListProps & { readonly section: ViewSection },
) {
  const {
    section,
    entities,
    metrics,
    selectedEntity,
    onSelectEntity,
    onRunAction,
    onOpenLogs,
    streamDefinitions,
    view,
  } = props

  switch (section._tag) {
    case "stat-grid":
      return (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {section.metrics.map((metric: ViewMetricRef) => {
            const latest = latestMetric(
              metrics,
              metric.metricId,
              view.kind === "detail" ? selectedEntity : null,
            )
            return (
              <div key={metric.metricId} className="rounded border border-border px-3 py-4">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {metric.label ?? metric.metricId}
                </div>
                <div className="mt-2 text-2xl font-semibold">
                  {latest ? formatMetricValue(latest.value, metric.unit ?? latest.unit) : "—"}
                </div>
              </div>
            )
          })}
        </div>
      )
    case "timeseries": {
      const chartData = buildTimeseries(
        metrics,
        section.metrics,
        view.kind === "detail" ? selectedEntity : null,
      )
      const unit = normalizeChartUnit(section.metrics)
      return chartData.length === 0 ? (
        <div className="text-sm text-muted-foreground">No metric history yet.</div>
      ) : (
        <MetricsChart
          data={chartData}
            dataKeys={section.metrics.map((metric: ViewMetricRef, index: number) => ({
            key: metric.metricId,
            label: metric.label ?? metric.metricId,
            color: CHART_COLORS[index % CHART_COLORS.length]!,
          }))}
          unit={unit}
          type="line"
          height={220}
        />
      )
    }
    case "entity-table": {
      const sectionEntities = entities.filter((entity) => entity.ref.kind === section.entityKind)
      return sectionEntities.length === 0 ? (
        <div className="text-sm text-muted-foreground">No entities found.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {section.columns.map((column: ViewColumn) => (
                <TableHead key={column.id}>{column.label}</TableHead>
              ))}
              {section.actions !== undefined && section.actions.length > 0 && (
                <TableHead>Actions</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sectionEntities.map((entity) => (
              <TableRow
                key={entity.ref.id}
                className="cursor-pointer"
                onClick={() => onSelectEntity(entity.ref.id)}
              >
                {section.columns.map((column: ViewColumn) => (
                  <TableCell key={column.id}>
                    {String(resolveColumnValue(entity, column, metrics) ?? "—")}
                  </TableCell>
                ))}
                {section.actions !== undefined && section.actions.length > 0 && (
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {section.actions.map((action: { actionId: string; label?: string }) => (
                        <Button
                          key={action.actionId}
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={(event) => {
                            event.stopPropagation()
                            void onRunAction(action.actionId, entity)
                          }}
                        >
                          {action.label ?? action.actionId}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )
    }
    case "detail":
      return selectedEntity === null ? (
        <div className="text-sm text-muted-foreground">Select an entity to inspect.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {section.fields.map((field: ViewColumn) => (
            <div key={field.id} className="rounded border border-border px-3 py-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {field.label}
              </div>
              <div className="mt-2 text-sm">
                {String(resolveColumnValue(selectedEntity, field, metrics) ?? "—")}
              </div>
            </div>
          ))}
        </div>
      )
    case "actions":
      return (
        <div className="flex flex-wrap gap-2">
          {section.actions.map((action: { actionId: string; label?: string }) => (
            <Button
              key={action.actionId}
              size="sm"
              variant="outline"
              onClick={() => void onRunAction(action.actionId, selectedEntity ?? undefined)}
            >
              {action.label ?? action.actionId}
            </Button>
          ))}
        </div>
      )
    case "logs":
      const streamDefinition = streamDefinitions.get(section.streamId)
      const logTarget = resolveLogTargetEntity(selectedEntity, entities, streamDefinition)
      const streamUnavailableReason = describeLogStreamAvailability(
        selectedEntity,
        logTarget,
        streamDefinition,
      )
      return (
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-muted-foreground">
            {streamUnavailableReason
              ?? (logTarget === selectedEntity || selectedEntity === null
                ? `Open ${logTarget?.ref.id ?? "selected"} logs.`
                : `Open logs from ${logTarget?.ref.id ?? "related entity"} related to ${selectedEntity.ref.id}.`)}
          </div>
          <Button
            size="sm"
            disabled={logTarget === null}
            onClick={() => onOpenLogs(section.streamId, logTarget ?? undefined)}
          >
            Open Logs
          </Button>
        </div>
      )
  }
}

function PluginActionSheet(props: {
  readonly action: PluginActionMetadata
  readonly entity?: EntitySnapshot
  readonly values: Record<string, unknown>
  readonly result: unknown
  readonly error: string | null
  readonly loading: boolean
  readonly onClose: () => void
  readonly onChange: (name: string, value: unknown) => void
  readonly onSubmit: () => Promise<void>
}) {
  const { action, entity, values, result, error, loading, onClose, onChange, onSubmit } = props

  return (
    <>
      <SheetHeader className="border-b border-border">
        <SheetTitle>{action.displayName}</SheetTitle>
        <SheetDescription>
          {entity !== undefined
            ? `Target: ${entity.ref.id}`
            : "Node-scoped action"}
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {action.description !== undefined && (
          <p className="text-xs text-muted-foreground">{action.description}</p>
        )}

        {action.requiresConfirmation && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            This action requires confirmation before execution.
          </div>
        )}

        {action.input.kind === "none" && (
          <div className="text-sm text-muted-foreground">
            No input is required for this action.
          </div>
        )}

        {action.input.kind === "unsupported" && (
          <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {action.input.reason}
          </div>
        )}

        {action.input.kind === "struct" && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void onSubmit()
            }}
          >
            {action.input.fields.map((field) => (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={`plugin-action-${field.name}`}>
                  {field.label}
                  {!field.required && <span className="text-muted-foreground"> optional</span>}
                </Label>
                <PluginActionFieldInput
                  field={field}
                  value={values[field.name]}
                  onChange={(value) => onChange(field.name, value)}
                />
              </div>
            ))}
          </form>
        )}

        {error !== null && (
          <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {result !== null && (
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Result
            </div>
            {isUnitFileResult(result) ? (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">{result.path}</div>
                <Textarea value={result.content} readOnly className="min-h-64 font-mono text-[11px]" />
              </div>
            ) : (
              <pre className="overflow-x-auto rounded border border-border bg-muted/30 p-3 text-[11px]">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
      <SheetFooter className="border-t border-border">
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Close
          </Button>
          <Button
            onClick={() => void onSubmit()}
            disabled={loading || action.input.kind === "unsupported"}
          >
            {loading ? "Running..." : "Run Action"}
          </Button>
        </div>
      </SheetFooter>
    </>
  )
}

function PluginActionFieldInput(props: {
  readonly field: PluginFormFieldMetadata
  readonly value: unknown
  readonly onChange: (value: unknown) => void
}) {
  const { field, value, onChange } = props
  const inputId = `plugin-action-${field.name}`

  switch (field.kind) {
    case "string":
      return field.multiline ? (
        <Textarea
          id={inputId}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-32"
        />
      ) : (
        <Input
          id={inputId}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case "number":
      return (
        <Input
          id={inputId}
          type="number"
          value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case "boolean":
      return (
        <div className="flex items-center gap-3">
          <Switch
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked)}
          />
          <span className="text-xs text-muted-foreground">
            {value === true ? "Enabled" : "Disabled"}
          </span>
        </div>
      )
    case "enum":
      return (
        <NativeSelect
          id={inputId}
          value={value !== undefined ? String(value) : ""}
          onChange={(event) => {
            const selected = field.options?.find((option) => String(option.value) === event.target.value)
            onChange(selected?.value ?? event.target.value)
          }}
          className="w-full"
        >
          {field.options?.map((option) => (
            <NativeSelectOption key={String(option.value)} value={String(option.value)}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )
  }
}

const CHART_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#9333ea"] as const

function buildInitialActionValues(input: PluginInputMetadata): Record<string, unknown> {
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

function normalizeActionInput(
  input: PluginInputMetadata,
  values: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (input.kind === "none") {
    return undefined
  }

  if (input.kind !== "struct") {
    return undefined
  }

  const output: Record<string, unknown> = {}

  for (const field of input.fields) {
    const raw = values[field.name]

    if (field.kind === "string") {
      const value = typeof raw === "string" ? raw : ""
      if (value.trim().length === 0) {
        if (field.required) {
          throw new Error(`${field.label} is required`)
        }
        continue
      }
      output[field.name] = value
      continue
    }

    if (field.kind === "number") {
      const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : ""
      if (text.length === 0) {
        if (field.required) {
          throw new Error(`${field.label} is required`)
        }
        continue
      }
      const value = Number(text)
      if (!Number.isFinite(value)) {
        throw new Error(`${field.label} must be a valid number`)
      }
      output[field.name] = value
      continue
    }

    if (field.kind === "boolean") {
      output[field.name] = raw === true
      continue
    }

    const options = field.options ?? []
    const option = options.find((candidate) => candidate.value === raw)
    if (option === undefined) {
      if (field.required) {
        throw new Error(`${field.label} is required`)
      }
      continue
    }
    output[field.name] = option.value
  }

  return Object.keys(output).length > 0 ? output : undefined
}

function hasRenderableActionResult(result: unknown): boolean {
  if (result === null || result === undefined) {
    return false
  }
  if (typeof result === "object") {
    return Object.keys(result as Record<string, unknown>).length > 0
  }
  return true
}

function isUnitFileResult(
  value: unknown,
): value is { readonly path: string; readonly content: string } {
  return value !== null
    && typeof value === "object"
    && typeof (value as Record<string, unknown>)["path"] === "string"
    && typeof (value as Record<string, unknown>)["content"] === "string"
}

function latestMetric(
  metrics: ReadonlyArray<MetricPoint>,
  metricId: string,
  entity: EntitySnapshot | null,
): MetricPoint | null {
  const matches = metrics.filter(
    (metric) => metric.metricId === metricId && metricMatchesEntity(metric, entity),
  )
  return matches.length === 0 ? null : matches[matches.length - 1] ?? null
}

function resolveColumnValue(
  entity: EntitySnapshot,
  column: ViewColumn,
  metrics: ReadonlyArray<MetricPoint>,
): unknown {
  switch (column.source._tag) {
    case "field":
      return getPathValue(entity, column.source.path)
    case "label":
      return entity.labels?.[column.source.key]
    case "status":
      return entity.status
    case "metric": {
      const metric = latestMetric(metrics, column.source.metricId, entity)
      return metric === null ? undefined : formatMetricValue(metric.value, metric.unit)
    }
  }
}

function getPathValue(entity: EntitySnapshot, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (value === null || value === undefined || typeof value !== "object") {
      return undefined
    }
    return (value as Record<string, unknown>)[segment]
  }, entity)
}

function buildTimeseries(
  metrics: ReadonlyArray<MetricPoint>,
  metricRefs: ReadonlyArray<ViewMetricRef>,
  entity: EntitySnapshot | null,
): Array<Record<string, unknown>> {
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

function normalizeChartUnit(
  metricRefs: ReadonlyArray<ViewMetricRef>,
): "%" | "bytes" | "bytes/s" {
  const unit = metricRefs[0]?.unit
  if (unit === "bytes" || unit === "bytes/s" || unit === "%") {
    return unit
  }
  return "%"
}

function formatMetricValue(value: number, unit?: string): string {
  if (unit === "bytes") {
    if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  }
  if (unit === "ns") {
    return `${Math.round(value / 1_000_000)} ms`
  }
  return String(Math.round(value))
}

function resolveLogTargetEntity(
  selectedEntity: EntitySnapshot | null,
  entities: ReadonlyArray<EntitySnapshot>,
  stream: PluginStreamMetadata | undefined,
): EntitySnapshot | null {
  if (selectedEntity === null || stream === undefined) {
    return selectedEntity
  }

  if (stream.targetKinds.includes(selectedEntity.ref.kind)) {
    return selectedEntity
  }

  const relationships = (selectedEntity.relationships ?? []) as ReadonlyArray<EntityRelationship>
  for (const relationship of relationships) {
    if (!stream.targetKinds.includes(relationship.target.kind)) {
      continue
    }
    const related = entities.find(
      (entity) =>
        entity.ref.pluginId === relationship.target.pluginId
        && entity.ref.kind === relationship.target.kind
        && entity.ref.nodeId === relationship.target.nodeId
        && entity.ref.id === relationship.target.id,
    )
    if (related !== undefined) {
      return related
    }
  }

  return null
}

function describeLogStreamAvailability(
  selectedEntity: EntitySnapshot | null,
  resolvedEntity: EntitySnapshot | null,
  stream: PluginStreamMetadata | undefined,
): string | null {
  if (stream === undefined) {
    return "This log stream is not available."
  }
  if (selectedEntity === null) {
    return "Select an entity to stream logs."
  }
  if (resolvedEntity === null) {
    return `No related ${stream.targetKinds.join(" / ")} target is available for this log stream.`
  }
  return null
}

function metricMatchesEntity(metric: MetricPoint, entity: EntitySnapshot | null): boolean {
  if (entity === null) {
    return metric.entity === undefined
  }

  return metric.entity !== undefined
    && metric.entity.pluginId === entity.ref.pluginId
    && metric.entity.kind === entity.ref.kind
    && metric.entity.nodeId === entity.ref.nodeId
    && metric.entity.id === entity.ref.id
}

function pickInitialEntityId(
  view: ViewDefinition | null,
  entities: ReadonlyArray<EntitySnapshot>,
): string | null {
  return pickEntityIdForView(view, entities) ?? entities[0]?.ref.id ?? null
}

function pickEntityIdForActiveView(
  view: ViewDefinition | null,
  selectedEntity: EntitySnapshot | null,
  entities: ReadonlyArray<EntitySnapshot>,
): string | null {
  if (selectedEntity !== null && entityMatchesView(selectedEntity, view)) {
    return selectedEntity.ref.id
  }

  return pickInitialEntityId(view, entities)
}

function pickEntityIdForView(
  view: ViewDefinition | null,
  entities: ReadonlyArray<EntitySnapshot>,
): string | null {
  if (view?.entityKind === undefined) {
    return entities[0]?.ref.id ?? null
  }

  return entities.find((entity) => entity.ref.kind === view.entityKind)?.ref.id ?? null
}

function entityMatchesView(entity: EntitySnapshot, view: ViewDefinition | null): boolean {
  return view?.entityKind === undefined || entity.ref.kind === view.entityKind
}
