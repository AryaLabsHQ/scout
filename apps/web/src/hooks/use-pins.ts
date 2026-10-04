import { useCallback, useSyncExternalStore } from "react"

/**
 * Units pinned to a machine's overview, stored in this browser only
 * (`localStorage`, one list per system). Nothing is sent to the hub.
 */
const keyFor = (systemId: string) => `scout:pins:${systemId}`
const listeners = new Set<() => void>()
const cache = new Map<string, { raw: string | null; value: ReadonlyArray<string> }>()
const EMPTY: ReadonlyArray<string> = []

const read = (systemId: string): ReadonlyArray<string> => {
  if (typeof window === "undefined") return EMPTY
  const raw = window.localStorage.getItem(keyFor(systemId))
  const cached = cache.get(systemId)
  if (cached && cached.raw === raw) return cached.value
  let value: ReadonlyArray<string> = EMPTY
  try {
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    value = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : EMPTY
  } catch {
    value = EMPTY
  }
  cache.set(systemId, { raw, value })
  return value
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith("scout:pins:")) listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

export function usePins(systemId: string) {
  const pins = useSyncExternalStore(subscribe, () => read(systemId), () => EMPTY)
  const toggle = useCallback(
    (id: string) => {
      const current = read(systemId)
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
      window.localStorage.setItem(keyFor(systemId), JSON.stringify(next))
      for (const listener of listeners) listener()
    },
    [systemId],
  )
  return { pins, isPinned: (id: string) => pins.includes(id), toggle }
}
