import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { LogViewer } from "@/components/log-viewer"
import { ConfirmAction } from "@/components/confirm-action"
import { fetchK8sWorkloads } from "@/server/workloads"
import { k8sRestartPod } from "@/server/management"
import { formatBytes, formatDuration } from "@/lib/format"
import type { K8sPod } from "@scout/shared"

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/pods/$podName")({
  validateSearch: (search: Record<string, unknown>) => ({
    namespace: (search["namespace"] as string) ?? "default",
    systemId: (search["systemId"] as string) ?? "",
  }),
  loader: async ({ params, context: _ctx }) => {
    // We fetch during render since we need search params too
    return { podName: params.podName }
  },
  component: PodDetailPage,
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function ContainerState({ state, reason }: { state: K8sPod["containers"][number]["state"]; reason: string | null }) {
  const map = {
    running: "bg-green-500/20 text-green-400 border-green-500/30",
    waiting: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    terminated: "bg-muted text-muted-foreground border-border",
  }
  return (
    <span className={`inline-flex items-center rounded-none border px-1.5 py-0 text-[10px] font-medium ${map[state]}`}>
      {state}{reason ? ` (${reason})` : ""}
    </span>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

function PodDetailPage() {
  const { podName } = Route.useParams()
  const { namespace, systemId } = Route.useSearch()

  const [pod, setPod] = useState<K8sPod | null>(null)
  const [loading, setLoading] = useState(false)
  const [logContainer, setLogContainer] = useState<string | null>(null)
  const [logSheetOpen, setLogSheetOpen] = useState(false)
  const [restarting, setRestarting] = useState(false)

  // Load on first render
  useState(() => {
    if (!systemId) return
    setLoading(true)
    fetchK8sWorkloads({ data: { systemId } })
      .then((data) => {
        if (data) {
          const found = data.pods.find((p) => p.name === podName && p.namespace === namespace)
          setPod(found ?? null)
        }
      })
      .finally(() => setLoading(false))
  })

  const openLogs = (containerName?: string) => {
    setLogContainer(containerName ?? pod?.containers[0]?.name ?? null)
    setLogSheetOpen(true)
  }

  async function handleRestartPod() {
    if (!systemId || !pod) return
    setRestarting(true)
    try {
      await k8sRestartPod({ data: { systemId, podName: pod.name, namespace: pod.namespace } })
      toast.success(`Restarted pod ${pod.name}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restart failed")
    } finally {
      setRestarting(false)
    }
  }

  return (
    <div className="p-4 md:p-6">
      {/* Back */}
      <Link
        to="/workloads"
        className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
        Workloads
      </Link>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : !pod ? (
        <p className="text-xs text-muted-foreground">
          Pod not found: {namespace}/{podName}
        </p>
      ) : (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex-1">
              <h1 className="font-heading text-lg font-semibold">{pod.name}</h1>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{pod.namespace}</span>
                {pod.nodeName && <span>node: {pod.nodeName}</span>}
                <span>age: {formatDuration(pod.age)}</span>
              </div>
            </div>
            <div className="flex gap-2">
              {/* Restart Pod */}
              <ConfirmAction
                title={`Restart ${pod.name}?`}
                description={`This will delete the pod and Kubernetes will recreate it.`}
                action="Restart"
                variant="destructive"
                onConfirm={handleRestartPod}
              >
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={restarting || !systemId}
                >
                  {restarting ? "Restarting..." : "Restart Pod"}
                </Button>
              </ConfirmAction>
              {/* Log viewer button */}
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => openLogs()}
                disabled={!systemId}
              >
                View Logs
              </Button>
              {/* Exec stub */}
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled
                  >
                    Exec Into Pod
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Coming in M6</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Phase + restarts */}
          <div className="flex flex-wrap gap-3">
            <div className="rounded-none border border-border bg-card px-3 py-2">
              <p className="text-[10px] text-muted-foreground">Phase</p>
              <p className="mt-0.5 text-sm font-medium">{pod.phase}</p>
            </div>
            <div className="rounded-none border border-border bg-card px-3 py-2">
              <p className="text-[10px] text-muted-foreground">Restarts</p>
              <p className="mt-0.5 text-sm font-medium">{pod.restarts}</p>
            </div>
            {pod.cpuMillicores !== null && (
              <div className="rounded-none border border-border bg-card px-3 py-2">
                <p className="text-[10px] text-muted-foreground">CPU</p>
                <p className="mt-0.5 text-sm font-medium">{pod.cpuMillicores}m</p>
              </div>
            )}
            {pod.memBytes !== null && (
              <div className="rounded-none border border-border bg-card px-3 py-2">
                <p className="text-[10px] text-muted-foreground">Memory</p>
                <p className="mt-0.5 text-sm font-medium">{formatBytes(pod.memBytes)}</p>
              </div>
            )}
          </div>

          {/* Containers */}
          <section>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Containers ({pod.containers.length})
            </h2>
            <div className="space-y-2">
              {pod.containers.map((c) => (
                <div
                  key={c.name}
                  className="flex flex-wrap items-center gap-3 rounded-none border border-border bg-card p-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs font-medium truncate">{c.name}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground truncate">{c.image}</p>
                  </div>
                  <ContainerState state={c.state} reason={c.reason} />
                  <Badge variant="outline" className="text-[9px]">
                    {c.restartCount} restart{c.restartCount !== 1 ? "s" : ""}
                  </Badge>
                  {c.ready && (
                    <Badge variant="secondary" className="text-[9px] bg-green-500/20 text-green-400">
                      Ready
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px] shrink-0"
                    onClick={() => openLogs(c.name)}
                    disabled={!systemId}
                  >
                    Logs
                  </Button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Log viewer sheet */}
      <Sheet open={logSheetOpen} onOpenChange={setLogSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Logs — {podName}</SheetTitle>
          </SheetHeader>
          {logSheetOpen && systemId && (
            <LogViewer
              agentId={systemId}
              source="k8s"
              target={podName}
              namespace={namespace}
              container={logContainer ?? undefined}
              onClose={() => setLogSheetOpen(false)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
