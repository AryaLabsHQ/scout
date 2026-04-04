import { createServerFn } from "@tanstack/react-start"
import { HUB_URL } from "./hub"
import type { K8sWorkloadMetrics, DockerContainerMetrics, SystemdServiceMetrics } from "@scout/shared"

export const fetchK8sWorkloads = createServerFn({ method: "GET" })
  .inputValidator((input: { systemId: string }) => input)
  .handler(async ({ data }): Promise<K8sWorkloadMetrics | null> => {
    const res = await fetch(`${HUB_URL}/api/systems/${data.systemId}/k8s`)
    if (!res.ok) return null
    return res.json() as Promise<K8sWorkloadMetrics | null>
  })

export const fetchDockerContainers = createServerFn({ method: "GET" })
  .inputValidator((input: { systemId: string }) => input)
  .handler(async ({ data }): Promise<DockerContainerMetrics[] | null> => {
    const res = await fetch(`${HUB_URL}/api/systems/${data.systemId}/docker`)
    if (!res.ok) return null
    return res.json() as Promise<DockerContainerMetrics[] | null>
  })

export const fetchSystemdServices = createServerFn({ method: "GET" })
  .inputValidator((input: { systemId: string }) => input)
  .handler(async ({ data }): Promise<SystemdServiceMetrics[] | null> => {
    const res = await fetch(`${HUB_URL}/api/systems/${data.systemId}/systemd`)
    if (!res.ok) return null
    return res.json() as Promise<SystemdServiceMetrics[] | null>
  })
