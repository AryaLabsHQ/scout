import type { System } from "@scout/shared"
import { pluginCapability } from "@/hooks/use-plugin-data"
import { EmptyRow } from "./section"

/** The last non-empty line of a failure reason: tools print the actual error last. */
const lastLine = (reason: string): string => {
  const line = reason.split("\n").filter((part) => part.trim().length > 0).at(-1) ?? reason
  return line.length > 220 ? `${line.slice(0, 217)}…` : line
}

/**
 * Whether a plugin can show data for this machine. Returns an empty-state row
 * explaining why not (not reporting, degraded, unsupported), or null when the
 * plugin is available.
 */
export function pluginUnavailable(system: System | null, pluginId: string, name: string) {
  const capability = pluginCapability(system, pluginId)
  if (capability === null) {
    return <EmptyRow>The {name} plugin is not reporting on this machine.</EmptyRow>
  }
  if (capability.status === "available") return null
  return (
    <EmptyRow>
      <span className="text-muted-foreground">
        The {name} plugin is {capability.status} on {system?.hostname ?? "this machine"}.
      </span>
      {capability.reason ? (
        <span className="mt-1 block break-words font-mono text-xs">{lastLine(capability.reason)}</span>
      ) : null}
    </EmptyRow>
  )
}
