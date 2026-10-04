import { dirname, join } from "node:path"
import { Config, Effect, Layer } from "effect"
import * as Context from "effect/Context"
import type { Context as ChordContext } from "@earendil-works/chord"
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context"
import { createRegistry, Harness } from "@earendil-works/pi-durable"
import type { Storage } from "@earendil-works/pi-durable"
import { ManagementError } from "@scout/shared"
import { AgentRegistry } from "../rpc/agent-bridge.js"
import { Database } from "./database.js"
import { MetricsIngestion } from "./metrics-ingestion.js"
import { OperatorApprovalsDoc } from "./operator-docs.js"
import { OperatorExtensions } from "./operator-extensions.js"
import { OperatorModelRegistry } from "./operator-model-registry.js"
import { OperatorSkills } from "./operator-skills.js"
import { openBunSqliteStorage } from "./operator-storage.js"
import {
  makeOperatorExtensions,
  type OperatorExtensionSet,
  type PluginInventoryManifest,
} from "./operator-tools.js"
import { PluginRegistry } from "./plugin-registry.js"

/**
 * Run a pi-durable call under the calling fiber: interrupting the fiber aborts the Chord context.
 * Cancelling a wait only cancels the wait; admitted durable work keeps going.
 */
export const durable = <A>(code: string, operation: (context: ChordContext) => Promise<A>) =>
  Effect.tryPromise({
    try: (signal) => operation(withAbortSignal(signal, BACKGROUND_CONTEXT)),
    catch: (error) =>
      error instanceof ManagementError
        ? error
        : new ManagementError({ code, message: error instanceof Error ? error.message : String(error) }),
  })

/** `SCOUT_OPERATOR_DB_PATH`, defaulting to `scout-operator.db` next to `SCOUT_DB_PATH`. */
export const operatorDatabasePath = (hubDatabasePath: string, configured: string): string => {
  if (configured.length > 0) return configured
  if (hubDatabasePath === ":memory:") return ":memory:"
  return join(dirname(hubDatabasePath), "scout-operator.db")
}

export interface OperatorHarnessShape {
  readonly harness: Harness
  readonly extensions: OperatorExtensionSet
}

/** Open a Harness over `storage` with Scout's extensions; closes it when the scope closes. */
export const openOperatorHarness = (storage: () => Promise<Storage>) =>
  Effect.gen(function* () {
    const db = yield* Database
    const ingestion = yield* MetricsIngestion
    const agents = yield* AgentRegistry
    const plugins = yield* PluginRegistry
    const operatorExtensions = yield* OperatorExtensions
    const skills = yield* OperatorSkills
    const modelSettings = yield* OperatorModelRegistry
    const loadedPlugins = yield* plugins.list()
    const operatorPlugins = yield* plugins.listOperatorPlugins()

    const manifests = new Map<string, PluginInventoryManifest>(
      loadedPlugins.map((plugin) => [
        plugin.manifest.id,
        {
          id: plugin.manifest.id,
          displayName: plugin.manifest.displayName,
          actions: plugin.manifest.actions,
          streams: plugin.manifest.streams,
          metrics: plugin.manifest.metrics,
          entityKinds: plugin.manifest.entityKinds,
        },
      ]),
    )
    const extensions = makeOperatorExtensions({
      db,
      ingestion,
      agents,
      manifests,
      operatorPlugins,
      extensions: operatorExtensions,
      skills,
      systemPrompt: modelSettings.systemPrompt,
    })
    const registry = createRegistry()
    registry.install(extensions.scout)
    registry.install(extensions.plan)

    const harness = yield* Effect.acquireRelease(
      durable("operator-storage-open", async (context) =>
        Harness.open(
          await storage(),
          {
            models: modelSettings.models,
            registry,
            // Plan mode is opt-in per conversation via configure().
            settings: { extensions: [extensions.scout], toolExecution: "parallel" },
            conversationCreated: async (tx, conversation) => {
              await tx.doc(OperatorApprovalsDoc, conversation.id)
            },
            onReport: (error) => {
              Effect.runFork(
                Effect.logWarning("OperatorHarness: extension failure", { error: String(error) }),
              )
            },
          },
          context,
        ),
      ),
      (opened) => durable("operator-storage-close", (context) => opened.close(context)).pipe(Effect.ignore),
    )
    // Continue runs the last process left unfinished: generations, tool calls, approval waits.
    harness.resume()
    return { harness, extensions } satisfies OperatorHarnessShape
  })

/**
 * The operator's pi-durable Harness over its own SQLite file. pi-durable owns that file's schema;
 * Scout's Drizzle migrations never touch it. One hub process owns the file at a time.
 */
export class OperatorHarness extends Context.Service<OperatorHarness, OperatorHarnessShape>()(
  "@scout/OperatorHarness",
  {
    make: Effect.gen(function* () {
      const hubDatabasePath = yield* Config.withDefault(Config.String("SCOUT_DB_PATH"), "./scout.db")
      const configuredPath = yield* Config.withDefault(Config.String("SCOUT_OPERATOR_DB_PATH"), "")
      const path = operatorDatabasePath(hubDatabasePath, configuredPath)
      return yield* openOperatorHarness(() => openBunSqliteStorage(path))
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
