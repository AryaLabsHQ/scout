import * as React from "react"
import { RegistryProvider, useAtomValue, useAtomInitialValues } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
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
      <PinHubClientRuntime />
      {initialState ? <SeedInitialValues state={initialState} /> : null}
      {children}
    </RegistryProvider>
  )
}

/**
 * Holds a permanent subscription to `HubClient.runtime` so the underlying
 * WebSocket stays open for the entire app lifetime. Without this, the atom
 * runtime's memoMap refcount can briefly hit zero during route transitions
 * and re-renders (between unmount/remount), which closes the layer's scope
 * and tears down the WebSocket — then the next subscriber opens a fresh
 * one. Empirically this caused 5–6 WS connects in rapid succession during
 * navigation churn.
 *
 * Mounted as a child of RegistryProvider (so the registry exists) and
 * before SeedInitialValues / children, so the runtime is alive by the
 * time any consumer asks for it.
 */
function PinHubClientRuntime() {
  useAtomValue(HubClient.runtime)
  return null
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
