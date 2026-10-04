import { useEffect } from "react"
import type { Atom } from "effect/reactivity"
import { useAtomRefresh } from "@effect/atom-react"

/**
 * Re-run a HubClient query on an interval while the component is mounted.
 * Plugin data and metric history are queries, not streams; agents report about
 * every 15 s, so polling at that rate keeps the page current.
 */
export function useRefreshInterval(atom: Atom.Atom<unknown>, intervalMs = 15_000) {
  const refresh = useAtomRefresh(atom)
  useEffect(() => {
    const id = window.setInterval(refresh, intervalMs)
    return () => window.clearInterval(id)
  }, [refresh, intervalMs])
}
