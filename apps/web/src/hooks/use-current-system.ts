import { useEffect, useState } from "react"
import { lastValue } from "@/lib/async-result"
import { useParams } from "@tanstack/react-router"
import { useAtomValue } from "@effect/atom-react"
import type { System } from "@scout/shared"
import { HubClient } from "@/rpc/client"

const LAST_SYSTEM_KEY = "scout:last-system"

/**
 * The machine the top bar's Overview / Services / Cluster links point at: the
 * route's `$systemId` when there is one, else the last machine visited in this
 * browser, else the first online machine.
 */
export function useCurrentSystem(): { readonly systems: ReadonlyArray<System>; readonly current: System | null } {
  const params = useParams({ strict: false }) as { readonly systemId?: string }
  const result = useAtomValue(HubClient.query("systems.list", undefined))
  const systems = lastValue(result, [])

  // Read after mount so the server render and the first client render agree.
  const [remembered, setRemembered] = useState<string | null>(null)
  useEffect(() => {
    if (params.systemId) window.localStorage.setItem(LAST_SYSTEM_KEY, params.systemId)
    setRemembered(window.localStorage.getItem(LAST_SYSTEM_KEY))
  }, [params.systemId])

  const current =
    systems.find((system) => system.id === params.systemId) ??
    systems.find((system) => system.id === remembered) ??
    [...systems].sort(bySystemOrder)[0] ??
    null
  return { systems, current }
}

/** Online machines first, then by hostname. */
export const bySystemOrder = (a: System, b: System): number =>
  Number(b.status === "online") - Number(a.status === "online") || a.hostname.localeCompare(b.hostname)
