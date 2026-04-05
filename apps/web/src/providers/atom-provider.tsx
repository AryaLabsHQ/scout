import * as React from "react"
import { RegistryProvider, useAtomInitialValues } from "@effect/atom-react"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type { Alert, System } from "@scout/shared"
import { HubClient } from "@/rpc/client"

export interface AtomInitialState {
  readonly systems?: ReadonlyArray<System>
  readonly alerts?: ReadonlyArray<Alert>
}

interface AtomProviderProps {
  children: React.ReactNode
  /**
   * Initial data fetched server-side (via TanStack Start loader) to seed
   * the corresponding query atoms so the first client render has
   * `Success` values instead of `Initial`.
   *
   * The values are decoded as `AsyncResult.success(data)` inside
   * `SeedInitialValues` below.
   */
  initialState?: AtomInitialState | undefined
}

/**
 * AtomProvider — wraps the app in an `AtomRegistry` and optionally seeds
 * a set of query atoms with SSR-fetched values.
 *
 * Replaces the old `ScoutProvider`. `TerminalProvider` and
 * `CommandPaletteProvider` remain separate since they manage pure UI state.
 */
export function AtomProvider({ children, initialState }: AtomProviderProps) {
  return (
    <RegistryProvider>
      {initialState ? <SeedInitialValues state={initialState} /> : null}
      {children}
    </RegistryProvider>
  )
}

/**
 * Project the SSR-fetched data into the corresponding AtomRpc query atoms.
 *
 * Uses `useAtomInitialValues` which, per the @effect/atom-react implementation,
 * calls `registry.ensureNode(atom).setValue(value)` for every pair but only
 * once per (registry, atom) — subsequent renders are no-ops. This is safe
 * to call at the top of the provider tree.
 */
function SeedInitialValues({ state }: { state: AtomInitialState }) {
  const pairs = React.useMemo(() => {
    const entries: Array<readonly [ReturnType<typeof HubClient.query>, unknown]> = []
    if (state.systems) {
      entries.push([
        HubClient.query("systems.list", undefined),
        AsyncResult.success(state.systems),
      ])
    }
    if (state.alerts) {
      entries.push([
        HubClient.query("alerts.list", undefined),
        AsyncResult.success(state.alerts),
      ])
    }
    return entries
  }, [state.systems, state.alerts])

  useAtomInitialValues(pairs)
  return null
}
