import type { AsyncResult, Atom } from "effect/reactivity"
import { useAtomValue, useAtomMount } from "@effect/atom-react"

/**
 * useHubQuery — read an AsyncResult atom, returning a fallback while
 * loading/erroring. Suitable for cases where rendering with empty data
 * is acceptable (lists, etc.).
 */
export function useHubQuery<A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>, fallback: A): A {
  const result = useAtomValue(atom)
  if (result._tag === "Success") return result.value
  return fallback
}

/**
 * useMountedHubQuery — same as useHubQuery but also mounts the atom so
 * it starts fetching immediately when the component mounts.
 */
export function useMountedHubQuery<A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>, fallback: A): A {
  useAtomMount(atom)
  return useHubQuery(atom, fallback)
}

export { useAtomValue, useAtomMount, useAtomSet, useAtom, useAtomRefresh } from "@effect/atom-react"
