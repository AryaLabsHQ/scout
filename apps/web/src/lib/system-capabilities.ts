import type { System } from "@scout/shared"

export function isPluginCapabilityAvailable(status: string) {
  return status !== "unsupported"
}

export function getAvailablePluginCapabilities(system: System) {
  return (system.pluginCapabilities ?? []).filter((capability) =>
    isPluginCapabilityAvailable(capability.status),
  )
}

export function hasAvailablePluginCapability(system: System, pluginId: string) {
  return getAvailablePluginCapabilities(system).some(
    (capability) => capability.pluginId === pluginId,
  )
}
