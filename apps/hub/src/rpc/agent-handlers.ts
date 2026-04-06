/**
 * AgentHubRpcs handler implementations — hub-side handlers for RPCs that
 * agents initiate.
 *
 * Only `agent.report` is implemented here. The `agent.connect` handler
 * lives in `agent-bridge.ts` because it needs per-connection closure
 * over the typed HubAgentClient and the AgentRegistry to register the
 * agent in one shot.
 */

import { Effect, Layer } from "effect"
import { AgentHubRpcs } from "@scout/shared"
import type { PluginCollectionResult } from "@scout/plugin-sdk"
import { MetricsIngestion } from "../services/metrics-ingestion.js"
import { MetricsBroadcast } from "../services/metrics-broadcast.js"
import { AlertEngine } from "../services/alert-engine.js"
import {
  alertMetricSamplesFromPluginCollection,
  alertMetricSamplesFromCoreMetrics,
} from "../services/alert-metrics.js"

const CoreMetricsHandlerLive = AgentHubRpcs.toLayerHandler(
  "agent.report",
  Effect.gen(function* () {
    const mi = yield* MetricsIngestion
    const broadcast = yield* MetricsBroadcast
    const alerts = yield* AlertEngine

    return (payload) =>
      Effect.gen(function* () {
        const typedPayload = payload as Parameters<typeof mi.ingest>[0]
        yield* mi.ingest(typedPayload)
        yield* broadcast.publishMetrics(typedPayload.sample)
        yield* alerts.evaluate(
          typedPayload.systemId,
          alertMetricSamplesFromCoreMetrics(typedPayload.sample),
        )
      })
  }),
)

const AgentPluginCollectionHandlerLive = AgentHubRpcs.toLayerHandler(
  "agent.reportPluginCollection",
  Effect.gen(function* () {
    const mi = yield* MetricsIngestion
    const alerts = yield* AlertEngine

    return ({
      systemId,
      collection,
    }: {
      systemId: string
      collection: PluginCollectionResult
    }) =>
      Effect.gen(function* () {
        yield* mi.ingestPluginCollection(systemId, collection)
        yield* alerts.evaluate(
          systemId,
          alertMetricSamplesFromPluginCollection(collection),
        )
      })
  }),
)

export const AgentHandlersLive = CoreMetricsHandlerLive.pipe(
  Layer.merge(AgentPluginCollectionHandlerLive),
)
