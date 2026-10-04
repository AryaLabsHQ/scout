import { useMemo } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useAtomSet } from "@effect/atom-react"
import { Page, PageHeader } from "@/components/section"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { HubClient } from "@/rpc/client"
import { fetchPluginDetail, fetchPluginEntities, fetchPluginMetrics } from "@/server/plugins"
import { fetchSystemDetail } from "@/server/systems"
import {
  buildPluginRouteInitialState,
  createActionFormSpec,
  createPluginRouteStore,
  getActivePrimaryScreen,
  getDetailScreen,
  getPrimaryScreens,
  getSelectedEntity,
  PluginUiRenderer,
  usePluginRouteStoreValue,
} from "@/lib/plugin-ui/runtime"
import type { EntitySnapshot, MetricPoint, PluginDetailResponse } from "@/lib/plugin-ui/types"

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
      plugin: plugin as PluginDetailResponse | null,
      entities: entities as ReadonlyArray<EntitySnapshot>,
      metrics: metrics as ReadonlyArray<MetricPoint>,
    }
  },
  component: PluginSystemPage,
})

function PluginSystemPage() {
  const { systemId } = Route.useParams()
  const { system, plugin, entities, metrics } = Route.useLoaderData()
  const runAction = useAtomSet(HubClient.mutation("plugins.runAction"), { mode: "promise" })

  const store = useMemo(() => {
    if (system === null || plugin === null) {
      return null
    }
    return createPluginRouteStore(
      buildPluginRouteInitialState(system as Record<string, unknown>, plugin, entities, metrics),
    )
  }, [entities, metrics, plugin, system])

  const pluginState = usePluginRouteStoreValue(store, (state) => state)

  const activePrimaryScreen =
    pluginState === null
      ? null
      : getActivePrimaryScreen(pluginState.plugin, pluginState.ui.activePrimaryScreenId)
  const selectedEntity = pluginState === null ? null : getSelectedEntity(pluginState)
  const detailScreen =
    pluginState === null
      ? null
      : getDetailScreen(pluginState.plugin, selectedEntity, pluginState.ui.activeDetailScreenId)
  const actionFormSpec =
    pluginState === null ? null : createActionFormSpec(pluginState.plugin, pluginState.ui.actionForm)
  const primaryScreens = pluginState === null ? [] : getPrimaryScreens(pluginState.plugin)

  if (
    system === null ||
    plugin === null ||
    store === null ||
    pluginState === null ||
    activePrimaryScreen === null
  ) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Plugin view not available.</p>
      </div>
    )
  }

  const setPrimaryScreen = (screenId: string) => {
    store.set("/ui/activePrimaryScreenId", screenId)
    const screen = pluginState.plugin.web?.screens.find((candidate) => candidate.id === screenId)
    if (screen?.entityKind !== undefined) {
      const nextEntity = pluginState.entities.find((entity) => entity.ref.kind === screen.entityKind) ?? null
      store.set("/selectedEntity", nextEntity ?? undefined)
      store.set("/ui/selectedEntityRef", nextEntity?.ref)
      return
    }
    if (pluginState.selectedEntity === undefined && pluginState.entities.length > 0) {
      const nextEntity = pluginState.entities[0]!
      store.set("/selectedEntity", nextEntity)
      store.set("/ui/selectedEntityRef", nextEntity.ref)
    }
  }

  return (
    <Page>
      <PageHeader
        crumbs={
          <>
            <Link to="/systems/$systemId" params={{ systemId }} className="hover:text-foreground">
              {String((system as Record<string, unknown>)["hostname"] ?? systemId)}
            </Link>
            <span>/</span>
            <span>{plugin.manifest.displayName}</span>
          </>
        }
        title={plugin.manifest.displayName}
        meta={
          <>
            <span className="font-mono">{plugin.manifest.id}</span>
            <span>v{plugin.manifest.version}</span>
            {((system as Record<string, any>)["pluginCapabilities"] ?? [])
              .filter((capability: Record<string, unknown>) => capability["pluginId"] === plugin.manifest.id)
              .map((capability: Record<string, unknown>) => (
                <span key={String(capability["pluginId"])}>{String(capability["status"])}</span>
              ))}
          </>
        }
      />
      <div className="mt-6" />

      {primaryScreens.length > 1 ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {primaryScreens.map((screen) => (
            <Button
              key={screen.id}
              size="sm"
              variant={screen.id === activePrimaryScreen.id ? "secondary" : "ghost"}
              onClick={() => setPrimaryScreen(screen.id)}
            >
              {screen.title}
            </Button>
          ))}
        </div>
      ) : null}

      <PluginUiRenderer store={store} spec={activePrimaryScreen.spec} runAction={runAction} />

      {detailScreen !== null && selectedEntity !== null ? (
        <div className="mt-6">
          <PluginUiRenderer store={store} spec={detailScreen.spec} runAction={runAction} />
        </div>
      ) : null}

      <Sheet
        open={pluginState.ui.actionForm !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            store.set("/ui/actionForm", undefined)
            store.set("/ui/actionError", undefined)
          }
        }}
      >
        <SheetContent side="right" className="w-full p-0 sm:max-w-xl">
          {pluginState.ui.actionForm !== undefined && actionFormSpec !== null ? (
            <>
              <SheetHeader className="border-b border-border">
                <SheetTitle>
                  {plugin.agent?.actions.find((action) => action.id === pluginState.ui.actionForm?.actionId)
                    ?.displayName ?? "Plugin Action"}
                </SheetTitle>
                <SheetDescription>
                  {pluginState.ui.actionForm.targetRef !== undefined
                    ? `Target: ${pluginState.ui.actionForm.targetRef.id}`
                    : "Node-scoped action"}
                </SheetDescription>
              </SheetHeader>
              <div className="overflow-y-auto p-4">
                <PluginUiRenderer store={store} spec={actionFormSpec} runAction={runAction} />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </Page>
  )
}
