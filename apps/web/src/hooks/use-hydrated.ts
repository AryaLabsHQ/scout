import { useSyncExternalStore } from "react"

const noop = () => () => {}

/**
 * False during SSR and hydration, true afterwards. Gate data the server cannot
 * have (queries that are not seeded by an SSR loader, such as the operator
 * session list) so the hydrated markup matches the server's.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )
}
