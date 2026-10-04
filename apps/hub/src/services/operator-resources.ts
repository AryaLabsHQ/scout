import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import type { OperatorResource } from "@scout/shared"
import { PluginRegistry } from "./plugin-registry.js"

const BUILTIN_RESOURCES: ReadonlyArray<OperatorResource> = [
  {
    id: "core/plugin-surfaces",
    title: "Scout Plugin Surfaces",
    description: "How Scout plugins can extend the operator.",
    source: "builtin",
    content: [
      "Scout plugins can expose agent, hub, web, and operator surfaces from one unified plugin definition.",
      "Operator surfaces are optional and may contribute tools, resources, skills, and lifecycle hooks.",
      "Prefer plugin-provided operator tools over bash.run when a plugin already exposes a typed capability.",
    ].join("\n"),
  },
]

export class OperatorResources extends Context.Service<
  OperatorResources,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<OperatorResource>>
    readonly resolve: (resourceIds: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<OperatorResource>>
  }
>()("@scout/OperatorResources", {
  make: Effect.gen(function* () {
    const pluginRegistry = yield* PluginRegistry
    const operatorPlugins = yield* pluginRegistry.listOperatorPlugins()

    const resourceMap = new Map<string, OperatorResource>()
    for (const resource of BUILTIN_RESOURCES) {
      resourceMap.set(resource.id, resource)
    }

    for (const plugin of operatorPlugins) {
      for (const resource of plugin.operator.resources ?? []) {
        const id = `${plugin.manifest.id}/${resource.id}`
        if (resourceMap.has(id)) {
          continue
        }

        resourceMap.set(id, {
          id,
          title: resource.title,
          description: resource.description,
          source: "plugin",
          content: resource.content,
        })
      }
    }

    const list = () =>
      Effect.succeed([...resourceMap.values()].sort((left, right) => left.title.localeCompare(right.title)))

    const resolve = (resourceIds: ReadonlyArray<string>) =>
      Effect.succeed(
        resourceIds.map((resourceId) => {
          const resource = resourceMap.get(resourceId)
          if (resource === undefined) {
            throw new Error(`Operator resource ${resourceId} is not available`)
          }
          return resource
        }),
      )

    return {
      list,
      resolve,
    }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
