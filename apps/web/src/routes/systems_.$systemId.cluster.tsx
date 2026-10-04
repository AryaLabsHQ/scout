import { createFileRoute, Link } from "@tanstack/react-router"
import { lastValue } from "@/lib/async-result"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { HugeiconsIcon } from "@hugeicons/react"
import { MoreHorizontalIcon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"
import type { EntitySnapshot } from "@scout/plugin-sdk"
import { K8S_ACTION_IDS, K8S_ENTITY_KINDS, K8S_PLUGIN_ID } from "@scout/plugin-k8s/contracts"
import { HubClient } from "@/rpc/client"
import { fetchSystemDetail } from "@/server/systems"
import { usePluginEntities, usePluginEvents } from "@/hooks/use-plugin-data"
import { useConfirm } from "@/providers/confirm-provider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EmptyRow, Page, PageHeader, Section } from "@/components/section"
import { TimeAgo } from "@/components/time-ago"
import { StatusDot } from "@/components/status-dot"
import { pluginUnavailable } from "@/components/plugin-status"
import { namespaceOf, podTone, summarizeNamespaces, workloadTone, workloadsOf } from "@/lib/k8s"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/systems_/$systemId/cluster")({
  validateSearch: (search: Record<string, unknown>): { namespace?: string } =>
    typeof search["namespace"] === "string" && search["namespace"].length > 0 ? { namespace: search["namespace"] } : {},
  loader: async ({ params }) => ({ detail: await fetchSystemDetail({ data: { systemId: params.systemId } }) }),
  component: ClusterPage,
})

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

function PodActions({ systemId, hostname, pod }: { systemId: string; hostname: string; pod: EntitySnapshot }) {
  const confirm = useConfirm()
  const runAction = useAtomSet(HubClient.mutation("plugins.runAction"), { mode: "promise" })
  const run = async (actionId: string, verb: string, effect: string, destructive: boolean) => {
    const confirmed = await confirm({
      title: `${verb} pod ${pod.ref.id} on ${hostname}?`,
      description: `${effect} Scout records this action in the hub audit log under your identity.`,
      command: `kubectl delete pod -n ${namespaceOf(pod)} ${pod.displayName ?? pod.ref.id}`,
      confirmLabel: verb,
      destructive,
    })
    if (!confirmed) return
    try {
      const result = await runAction({
        payload: {
          agentId: systemId,
          pluginId: K8S_PLUGIN_ID,
          actionId,
          entity: { pluginId: K8S_PLUGIN_ID, kind: pod.ref.kind, id: pod.ref.id },
        },
      })
      if (result.success) toast.success(result.summary ?? `${verb}: done`)
      else toast.error(result.summary ?? `${verb} failed`)
    } catch (error) {
      toast.error(`${verb} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="inline-grid size-7 place-items-center rounded-md text-subtle hover:bg-muted hover:text-foreground"
            aria-label={`Actions for ${pod.ref.id}`}
          />
        }
      >
        <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem
          onClick={() =>
            void run(K8S_ACTION_IDS.restartPod, "Restart", "The pod is deleted and its controller schedules a replacement.", false)
          }
        >
          Restart pod…
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={() =>
            void run(K8S_ACTION_IDS.deletePod, "Delete", "The pod is deleted; only a controller brings it back.", true)
          }
        >
          Delete pod…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ClusterPage() {
  const { systemId } = Route.useParams()
  const { namespace: selected } = Route.useSearch()
  const { detail } = Route.useLoaderData()
  const systemResult = useAtomValue(HubClient.query("systems.get", { id: systemId }))
  const system = lastValue(systemResult, null) ?? detail
  const hostname = system?.hostname ?? systemId
  const entities = usePluginEntities(systemId, K8S_PLUGIN_ID)
  const events = usePluginEvents(systemId, K8S_PLUGIN_ID, 1)
  const unavailable = pluginUnavailable(system, K8S_PLUGIN_ID, "Kubernetes")

  const namespaces = summarizeNamespaces(entities.items)
  const inScope = (entity: EntitySnapshot) => selected === undefined || namespaceOf(entity) === selected
  const workloads = workloadsOf(entities.items).filter((workload) => selected === undefined || workload.namespace === selected)
  const pods = entities.items
    .filter((entity) => entity.ref.kind === K8S_ENTITY_KINDS.pod && inScope(entity))
    .sort((a, b) => a.ref.id.localeCompare(b.ref.id))
  const warnings = events.items
    .filter((event) => event.severity !== "info")
    .filter((event) => selected === undefined || event.entity?.id.startsWith(`${selected}/`) || event.entity?.id === selected)
    .sort((a, b) => b.ts - a.ts)
  const readyPods = pods.filter((pod) => pod.status === "ready" || pod.status === "succeeded").length

  return (
    <Page>
      <PageHeader
        crumbs={
          <>
            <Link to="/systems/$systemId" params={{ systemId }} className="hover:text-foreground">
              {hostname}
            </Link>
            <span>/</span>
            <span>Cluster</span>
          </>
        }
        title="Cluster"
        meta={<span>Kubernetes as seen by the agent on {hostname}</span>}
      />

      {unavailable ? (
        <Section className="mt-6">{unavailable}</Section>
      ) : entities.loading ? (
        <Section className="mt-6">
          <EmptyRow>Loading cluster…</EmptyRow>
        </Section>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-lg border border-border lg:grid-cols-4">
            {[
              ["Namespaces", String(namespaces.length)],
              ["Workloads", String(workloads.length)],
              ["Pods ready", `${readyPods}/${pods.length}`],
              ["Warning events · 1h", String(warnings.length)],
            ].map(([label, value], index) => (
              <div
                key={label}
                className={cn(
                  "px-5 py-4",
                  index % 2 === 1 && "border-l border-border",
                  index >= 2 && "border-t border-border lg:border-t-0",
                  index === 2 && "lg:border-l",
                )}
              >
                <div className="text-[12.5px] text-muted-foreground">{label}</div>
                <div className="mt-1.5 font-mono text-[22px] font-medium tabular">{value}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-1.5">
            <Link
              to="/systems/$systemId/cluster"
              params={{ systemId }}
              search={{}}
              className={cn(
                "inline-flex h-7 items-center rounded-full border px-3 text-[12.5px]",
                selected === undefined ? "border-border-strong bg-muted" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              All namespaces
            </Link>
            {namespaces.map((namespace) => (
              <Link
                key={namespace.name}
                to="/systems/$systemId/cluster"
                params={{ systemId }}
                search={{ namespace: namespace.name }}
                className={cn(
                  "inline-flex h-7 items-center gap-2 rounded-full border px-3 font-mono text-[12px]",
                  selected === namespace.name
                    ? "border-border-strong bg-muted"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <StatusDot tone={namespace.tone} className="size-1.5" />
                {namespace.name}
              </Link>
            ))}
          </div>

          <Section className="mt-4" title="Workloads" aside={<span>Deployments</span>}>
            {workloads.length === 0 ? (
              <EmptyRow>No deployments{selected ? ` in ${selected}` : ""}.</EmptyRow>
            ) : (
              <table className="w-full table-fixed text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-raised text-xs text-subtle">
                    <th className="px-4 py-2 font-normal">Workload</th>
                    <th className="px-4 py-2 font-normal">Namespace</th>
                    <th className="w-32 px-4 py-2 font-normal">Status</th>
                    <th className="w-24 px-4 py-2 text-right font-normal">Ready</th>
                  </tr>
                </thead>
                <tbody>
                  {workloads.map((workload) => (
                    <tr key={workload.entity.ref.id} className="border-t border-border first:border-t-0">
                      <td className="truncate px-4 py-2.5">
                        <span className="flex items-center gap-2.5">
                          <StatusDot tone={workloadTone(workload)} />
                          <span className="truncate font-mono">{workload.name}</span>
                        </span>
                      </td>
                      <td className="truncate px-4 py-2.5 font-mono text-muted-foreground">{workload.namespace}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{workload.status}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular">
                        {workload.ready}/{workload.desired}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section className="mt-6" title="Pods" aside={<span className="tabular">{pods.length}</span>}>
            {pods.length === 0 ? (
              <EmptyRow>No pods{selected ? ` in ${selected}` : ""}.</EmptyRow>
            ) : (
              <table className="w-full table-fixed text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-raised text-xs text-subtle">
                    <th className="px-4 py-2 font-normal">Pod</th>
                    <th className="w-40 px-4 py-2 font-normal">Namespace</th>
                    <th className="w-28 px-4 py-2 font-normal">Phase</th>
                    <th className="w-24 px-4 py-2 text-right font-normal">Restarts</th>
                    <th className="w-12 px-2 py-2 font-normal" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {pods.map((pod) => (
                    <tr key={pod.ref.id} className="border-t border-border first:border-t-0">
                      <td className="truncate px-4 py-2">
                        <span className="flex items-center gap-2.5">
                          <StatusDot tone={podTone(pod)} />
                          <span className="truncate font-mono">{pod.displayName ?? pod.ref.id}</span>
                        </span>
                      </td>
                      <td className="truncate px-4 py-2 font-mono text-muted-foreground">{namespaceOf(pod)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{pod.status ?? "unknown"}</td>
                      <td className="px-4 py-2 text-right font-mono tabular text-muted-foreground">
                        {String(record(pod.state)["restarts"] ?? 0)}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <PodActions systemId={systemId} hostname={hostname} pod={pod} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section className="mt-6" title="Events" aside={<span>warnings · 1h</span>}>
            {warnings.length === 0 ? (
              <EmptyRow>No warning events</EmptyRow>
            ) : (
              <ul>
                {warnings.map((event, index) => (
                  <li
                    key={`${event.ts}:${index}`}
                    className="flex gap-3 border-t border-border px-4 py-2.5 text-[13px] first:border-t-0"
                  >
                    <StatusDot tone={event.severity === "error" ? "err" : "warn"} className="mt-1.5" />
                    <span className="min-w-0 flex-1">
                      <span className="font-mono">{event.entity?.id ?? event.eventId}</span>{" "}
                      <span className="text-muted-foreground">{event.message}</span>
                    </span>
                    <span className="shrink-0 text-subtle"><TimeAgo at={event.ts} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </Page>
  )
}
