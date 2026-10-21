/**
 * AgentHubRpcs handler implementations — hub-side handlers for RPCs that
 * agents initiate.
 *
 * Core and plugin reports are guarded here. The `agent.connect` handler
 * lives in `agent-bridge.ts` because it needs per-connection closure
 * over the typed HubAgentClient and the AgentRegistry to register the
 * agent in one shot.
 */

import { Context, Effect, Layer, Ref } from "effect"
import { AgentHubRpcs, AgentReportError } from "@scout/shared"
import type { PluginCollectionResult } from "@scout/plugin-sdk"
import { MetricsIngestion } from "../services/metrics-ingestion.js"
import { MetricsBroadcast } from "../services/metrics-broadcast.js"
import { AlertEngine } from "../services/alert-engine.js"
import {
  alertMetricSamplesFromPluginCollection,
  alertMetricSamplesFromCoreMetrics,
} from "../services/alert-metrics.js"

/** The bridge supplies a fresh slot for each socket, after successful registration. */
export class AgentConnectionIdentity extends Context.Service<
  AgentConnectionIdentity,
  Ref.Ref<string | null>
>()("@scout/AgentConnectionIdentity") {}

const requireSystem = (identity: Ref.Ref<string | null>, systemId: string) =>
  Effect.gen(function* () {
    const registered = yield* Ref.get(identity)
    if (registered === null) {
      return yield* Effect.fail(
        new AgentReportError({ reason: "not-connected", message: "Call agent.connect before reporting" }),
      )
    }
    if (registered !== systemId) {
      return yield* Effect.fail(
        new AgentReportError({
          reason: "system-mismatch",
          message: `Report systemId must match registered host "${registered}"`,
        }),
      )
    }
  })

const collectionHasForeignNode = (systemId: string, collection: PluginCollectionResult): boolean =>
  (collection.entities ?? []).some(
    (entity) =>
      entity.ref.nodeId !== systemId ||
      (entity.relationships ?? []).some((relationship) => relationship.target.nodeId !== systemId),
  ) ||
  (collection.metrics ?? []).some(
    (metric) => metric.entity !== undefined && metric.entity.nodeId !== systemId,
  ) ||
  (collection.events ?? []).some((event) => event.entity !== undefined && event.entity.nodeId !== systemId)

const CoreMetricsHandlerLive = AgentHubRpcs.toLayerHandler(
  "agent.report",
  Effect.gen(function* () {
    const identity = yield* AgentConnectionIdentity
    const mi = yield* MetricsIngestion
    const broadcast = yield* MetricsBroadcast
    const alerts = yield* AlertEngine

    return (payload) =>
      Effect.gen(function* () {
        yield* requireSystem(identity, payload.systemId)
        yield* mi.ingest(payload)
        yield* broadcast.publishMetrics(payload.sample)
        yield* alerts.evaluate(payload.systemId, alertMetricSamplesFromCoreMetrics(payload.sample))
      })
  }),
)

const AgentPluginCollectionHandlerLive = AgentHubRpcs.toLayerHandler(
  "agent.reportPluginCollection",
  Effect.gen(function* () {
    const identity = yield* AgentConnectionIdentity
    const mi = yield* MetricsIngestion
    const alerts = yield* AlertEngine

    return ({ systemId, collection }: { systemId: string; collection: PluginCollectionResult }) =>
      Effect.gen(function* () {
        yield* requireSystem(identity, systemId)
        if (collectionHasForeignNode(systemId, collection)) {
          return yield* Effect.fail(
            new AgentReportError({
              reason: "node-mismatch",
              message: "Every collection node reference must match the registered host",
            }),
          )
        }
        yield* mi.ingestPluginCollection(systemId, collection)
        yield* alerts.evaluate(systemId, alertMetricSamplesFromPluginCollection(collection))
      })
  }),
)

export const AgentHandlersLive = CoreMetricsHandlerLive.pipe(Layer.merge(AgentPluginCollectionHandlerLive))
