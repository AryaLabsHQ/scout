import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useScout } from "@/providers/scout-provider"
import { fetchK8sWorkloads } from "@/server/workloads"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatBytes, formatDuration } from "@/lib/format"
import type { K8sWorkloadMetrics, K8sPod, K8sDeployment, K8sService, K8sIngress, K8sJob } from "@scout/shared"

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/workloads")({
  component: WorkloadsPage,
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function PodPhaseBadge({ phase }: { phase: K8sPod["phase"] }) {
  const variants: Record<K8sPod["phase"], { label: string; className: string }> = {
    Running: { label: "Running", className: "bg-green-500/20 text-green-400 border-green-500/30" },
    Pending: { label: "Pending", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
    Failed: { label: "Failed", className: "bg-red-500/20 text-red-400 border-red-500/30" },
    Succeeded: { label: "Succeeded", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    Unknown: { label: "Unknown", className: "bg-muted text-muted-foreground" },
  }
  const v = variants[phase]
  return (
    <span className={`inline-flex items-center rounded-none border px-1.5 py-0 text-[10px] font-medium ${v.className}`}>
      {v.label}
    </span>
  )
}

function DeploymentStatusBadge({ ready, desired }: { ready: number; desired: number }) {
  const ok = ready >= desired && desired > 0
  return (
    <span className={`inline-flex items-center rounded-none border px-1.5 py-0 text-[10px] font-medium ${
      ok
        ? "bg-green-500/20 text-green-400 border-green-500/30"
        : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
    }`}>
      {ready}/{desired}
    </span>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function PodsTab({ pods, namespace, systemId }: { pods: K8sPod[]; namespace: string; systemId: string }) {
  const navigate = useNavigate()
  const filtered = namespace === "__all__" ? pods : pods.filter((p) => p.namespace === namespace)

  if (filtered.length === 0) {
    return <EmptyRow cols={7} message="No pods" />
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Namespace</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Restarts</TableHead>
          <TableHead>CPU</TableHead>
          <TableHead>Memory</TableHead>
          <TableHead>Age</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.map((pod) => (
          <TableRow
            key={`${pod.namespace}/${pod.name}`}
            className="cursor-pointer"
            onClick={() =>
              navigate({
                to: "/pods/$podName",
                params: { podName: pod.name },
                search: { namespace: pod.namespace, systemId },
              })
            }
          >
            <TableCell className="font-mono text-[11px]">{pod.name}</TableCell>
            <TableCell>{pod.namespace}</TableCell>
            <TableCell><PodPhaseBadge phase={pod.phase} /></TableCell>
            <TableCell>{pod.restarts}</TableCell>
            <TableCell>{pod.cpuMillicores !== null ? `${pod.cpuMillicores}m` : "—"}</TableCell>
            <TableCell>{pod.memBytes !== null ? formatBytes(pod.memBytes) : "—"}</TableCell>
            <TableCell>{formatDuration(pod.age)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function DeploymentsTab({ deployments, namespace }: { deployments: K8sDeployment[]; namespace: string }) {
  const filtered = namespace === "__all__" ? deployments : deployments.filter((d) => d.namespace === namespace)
  if (filtered.length === 0) return <EmptyRow cols={5} message="No deployments" />

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Namespace</TableHead>
          <TableHead>Ready</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead>Age</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.map((d) => (
          <TableRow key={`${d.namespace}/${d.name}`}>
            <TableCell className="font-mono text-[11px]">{d.name}</TableCell>
            <TableCell>{d.namespace}</TableCell>
            <TableCell>
              <DeploymentStatusBadge ready={d.readyReplicas} desired={d.desiredReplicas} />
            </TableCell>
            <TableCell>{d.updatedReplicas}</TableCell>
            <TableCell>{formatDuration(d.age)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ServicesTab({ services, namespace }: { services: K8sService[]; namespace: string }) {
  const filtered = namespace === "__all__" ? services : services.filter((s) => s.namespace === namespace)
  if (filtered.length === 0) return <EmptyRow cols={5} message="No services" />

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Namespace</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Cluster IP</TableHead>
          <TableHead>Ports</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.map((svc) => (
          <TableRow key={`${svc.namespace}/${svc.name}`}>
            <TableCell className="font-mono text-[11px]">{svc.name}</TableCell>
            <TableCell>{svc.namespace}</TableCell>
            <TableCell>
              <Badge variant="outline" className="text-[9px]">{svc.type}</Badge>
            </TableCell>
            <TableCell className="font-mono text-[11px]">{svc.clusterIP || "—"}</TableCell>
            <TableCell className="font-mono text-[11px]">
              {svc.ports.map((p) => `${p.port}/${p.protocol}`).join(", ") || "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function IngressTab({ ingresses, namespace }: { ingresses: K8sIngress[]; namespace: string }) {
  const filtered = namespace === "__all__" ? ingresses : ingresses.filter((i) => i.namespace === namespace)
  if (filtered.length === 0) return <EmptyRow cols={4} message="No ingress resources" />

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Namespace</TableHead>
          <TableHead>Hosts</TableHead>
          <TableHead>Paths</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.map((ing) => (
          <TableRow key={`${ing.namespace}/${ing.name}`}>
            <TableCell className="font-mono text-[11px]">{ing.name}</TableCell>
            <TableCell>{ing.namespace}</TableCell>
            <TableCell className="font-mono text-[11px]">
              {ing.rules.map((r) => r.host).join(", ") || "—"}
            </TableCell>
            <TableCell className="font-mono text-[11px]">
              {ing.rules.flatMap((r) => r.paths.map((p) => p.path)).join(", ") || "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function JobsTab({ jobs, namespace }: { jobs: K8sJob[]; namespace: string }) {
  const filtered = namespace === "__all__" ? jobs : jobs.filter((j) => j.namespace === namespace)
  if (filtered.length === 0) return <EmptyRow cols={5} message="No jobs" />

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Namespace</TableHead>
          <TableHead>Completions</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.map((job) => {
          const complete = job.succeeded >= job.completions && job.completions > 0
          const status = complete ? "Complete" : job.failed > 0 ? "Failed" : "Running"
          const statusClass = complete
            ? "bg-green-500/20 text-green-400 border-green-500/30"
            : job.failed > 0
              ? "bg-red-500/20 text-red-400 border-red-500/30"
              : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"

          return (
            <TableRow key={`${job.namespace}/${job.name}`}>
              <TableCell className="font-mono text-[11px]">{job.name}</TableCell>
              <TableCell>{job.namespace}</TableCell>
              <TableCell>{job.succeeded}/{job.completions}</TableCell>
              <TableCell>{job.duration !== null ? formatDuration(job.duration) : "—"}</TableCell>
              <TableCell>
                <span className={`inline-flex items-center rounded-none border px-1.5 py-0 text-[10px] font-medium ${statusClass}`}>
                  {status}
                </span>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <Table>
      <TableBody>
        <TableRow>
          <TableCell colSpan={cols} className="py-8 text-center text-muted-foreground">
            {message}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

function WorkloadsPage() {
  const { systems } = useScout()

  // K8s-capable agents
  const k8sAgents = Object.values(systems).filter(
    (s) => s.system.capabilities.k8s && s.system.status === "online"
  )

  const [selectedSystemId, setSelectedSystemId] = useState<string>("")
  const [workloads, setWorkloads] = useState<K8sWorkloadMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [namespace, setNamespace] = useState("__all__")

  // Pick first agent automatically
  const effectiveSystemId = selectedSystemId || k8sAgents[0]?.system.id || ""

  async function loadWorkloads(systemId: string) {
    if (!systemId) return
    setLoading(true)
    try {
      const data = await fetchK8sWorkloads({ data: { systemId } })
      setWorkloads(data)
      setNamespace("__all__")
    } finally {
      setLoading(false)
    }
  }

  // Load when effectiveSystemId changes
  useState(() => {
    if (effectiveSystemId) {
      void loadWorkloads(effectiveSystemId)
    }
  })

  if (k8sAgents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
        <p className="font-medium">No Kubernetes-enabled agents connected</p>
        <p className="text-xs text-muted-foreground">
          Connect an agent with K8s access to view workloads.
        </p>
      </div>
    )
  }

  // Gather all namespaces from workloads
  const namespaces = workloads
    ? Array.from(
        new Set([
          ...workloads.pods.map((p) => p.namespace),
          ...workloads.deployments.map((d) => d.namespace),
          ...workloads.services.map((s) => s.namespace),
        ])
      ).sort()
    : []

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-base font-semibold flex-1">Workloads</h1>

        {/* Agent selector */}
        {k8sAgents.length > 1 && (
          <Select
            value={effectiveSystemId}
            onValueChange={(v: string | null) => {
              if (!v) return
              setSelectedSystemId(v)
              void loadWorkloads(v)
            }}
          >
            <SelectTrigger size="sm" className="w-48">
              <SelectValue placeholder="Select agent" />
            </SelectTrigger>
            <SelectContent>
              {k8sAgents.map((s) => (
                <SelectItem key={s.system.id} value={s.system.id}>
                  {s.system.hostname}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Namespace filter */}
        {namespaces.length > 0 && (
          <Select value={namespace} onValueChange={(v: string | null) => { if (v) setNamespace(v) }}>
            <SelectTrigger size="sm" className="w-40">
              <SelectValue placeholder="All namespaces" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All namespaces</SelectItem>
              {namespaces.map((ns) => (
                <SelectItem key={ns} value={ns}>
                  {ns}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs text-muted-foreground">Loading...</div>
      ) : !workloads ? (
        <div className="py-12 text-center text-xs text-muted-foreground">
          No workload data available. Agent may not have K8s access.
        </div>
      ) : (
        <Tabs defaultValue="pods">
          <TabsList>
            <TabsTrigger value="pods">
              Pods ({workloads.pods.length})
            </TabsTrigger>
            <TabsTrigger value="deployments">
              Deployments ({workloads.deployments.length})
            </TabsTrigger>
            <TabsTrigger value="services">
              Services ({workloads.services.length})
            </TabsTrigger>
            <TabsTrigger value="ingress">
              Ingress ({workloads.ingresses.length})
            </TabsTrigger>
            <TabsTrigger value="jobs">
              Jobs ({workloads.jobs.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pods">
            <PodsTab pods={workloads.pods} namespace={namespace} systemId={effectiveSystemId} />
          </TabsContent>
          <TabsContent value="deployments">
            <DeploymentsTab deployments={workloads.deployments} namespace={namespace} />
          </TabsContent>
          <TabsContent value="services">
            <ServicesTab services={workloads.services} namespace={namespace} />
          </TabsContent>
          <TabsContent value="ingress">
            <IngressTab ingresses={workloads.ingresses} namespace={namespace} />
          </TabsContent>
          <TabsContent value="jobs">
            <JobsTab jobs={workloads.jobs} namespace={namespace} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
