import { createServerFn } from "@tanstack/react-start"
import { HUB_URL } from "./hub"
import type { UnitFile } from "@scout/shared"

// ── Systemd ───────────────────────────────────────────────────────────────────

export const systemdAction = createServerFn({ method: "POST" })
  .inputValidator((input: { systemId: string; unit: string; action: "start" | "stop" | "restart" | "enable" | "disable" }) => input)
  .handler(async ({ data }) => {
    const { systemId, unit, action } = data
    const res = await fetch(
      `${HUB_URL}/api/systems/${encodeURIComponent(systemId)}/systemd/${encodeURIComponent(unit)}/${action}`,
      { method: "POST" },
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: "Unknown error" })) as { message?: string }
      throw new Error(err.message ?? "Action failed")
    }
    return res.json()
  })

export const systemdReload = createServerFn({ method: "POST" })
  .inputValidator((input: { systemId: string }) => input)
  .handler(async ({ data }) => {
    const res = await fetch(
      `${HUB_URL}/api/systems/${encodeURIComponent(data.systemId)}/systemd/reload`,
      { method: "POST" },
    )
    if (!res.ok) throw new Error("daemon-reload failed")
    return res.json()
  })

export const getUnitFile = createServerFn({ method: "GET" })
  .inputValidator((input: { systemId: string; unit: string }) => input)
  .handler(async ({ data }): Promise<UnitFile> => {
    const res = await fetch(
      `${HUB_URL}/api/systems/${encodeURIComponent(data.systemId)}/systemd/${encodeURIComponent(data.unit)}/file`,
    )
    if (!res.ok) throw new Error("Could not fetch unit file")
    return res.json() as Promise<UnitFile>
  })

export const editUnitFile = createServerFn({ method: "POST" })
  .inputValidator((input: { systemId: string; unit: string; content: string }) => input)
  .handler(async ({ data }) => {
    const res = await fetch(
      `${HUB_URL}/api/systems/${encodeURIComponent(data.systemId)}/systemd/${encodeURIComponent(data.unit)}/file`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: data.content }),
      },
    )
    if (!res.ok) throw new Error("Could not save unit file")
    return res.json()
  })

// ── Docker ────────────────────────────────────────────────────────────────────

export const dockerAction = createServerFn({ method: "POST" })
  .inputValidator((input: { systemId: string; containerId: string; action: "start" | "stop" | "restart" | "remove" }) => input)
  .handler(async ({ data }) => {
    const { systemId, containerId, action } = data
    const res = await fetch(
      `${HUB_URL}/api/systems/${encodeURIComponent(systemId)}/docker/${encodeURIComponent(containerId)}/${action}`,
      { method: "POST" },
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: "Unknown error" })) as { message?: string }
      throw new Error(err.message ?? "Action failed")
    }
    return res.json()
  })

export const dockerInspect = createServerFn({ method: "GET" })
  .inputValidator((input: { systemId: string; containerId: string }) => input)
  .handler(async ({ data }): Promise<string> => {
    const res = await fetch(
      `${HUB_URL}/api/systems/${encodeURIComponent(data.systemId)}/docker/${encodeURIComponent(data.containerId)}/inspect`,
    )
    if (!res.ok) throw new Error("Could not inspect container")
    return res.text()
  })

// ── K8s ───────────────────────────────────────────────────────────────────────

export const k8sScale = createServerFn({ method: "POST" })
  .inputValidator((input: { systemId: string; deployment: string; namespace: string; replicas: number }) => input)
  .handler(async ({ data }) => {
    const { systemId, deployment, namespace, replicas } = data
    const res = await fetch(
      `${HUB_URL}/api/systems/${encodeURIComponent(systemId)}/k8s/scale`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deployment, namespace, replicas }),
      },
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: "Unknown error" })) as { message?: string }
      throw new Error(err.message ?? "Scale failed")
    }
    return res.json()
  })

export const k8sRestartPod = createServerFn({ method: "POST" })
  .inputValidator((input: { systemId: string; podName: string; namespace: string }) => input)
  .handler(async ({ data }) => {
    const { systemId, podName, namespace } = data
    const res = await fetch(
      `${HUB_URL}/api/systems/${encodeURIComponent(systemId)}/k8s/restart-pod`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ podName, namespace }),
      },
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: "Unknown error" })) as { message?: string }
      throw new Error(err.message ?? "Restart failed")
    }
    return res.json()
  })
