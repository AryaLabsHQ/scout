/**
 * AgentHubRpcs handler implementations — hub-side handlers for RPCs that
 * agents initiate.
 *
 * Only `agent.report` is implemented here. The `agent.connect` handler
 * lives in `agent-bridge.ts` because it needs per-connection closure
 * over the typed HubAgentClient and the AgentRegistry to register the
 * agent in one shot.
 */

import { Effect } from "effect"
import { AgentHubRpcs } from "@scout/shared"
import { MetricsIngestion } from "../services/metrics-ingestion.js"
import { MetricsBroadcast } from "../services/metrics-broadcast.js"
import { AlertEngine } from "../services/alert-engine.js"

export const AgentHandlersLive = AgentHubRpcs.toLayerHandler(
  "agent.report",
  Effect.gen(function* () {
    const mi = yield* MetricsIngestion
    const broadcast = yield* MetricsBroadcast
    const alerts = yield* AlertEngine

    return (report) =>
      Effect.gen(function* () {
        const typedReport = report as Parameters<typeof mi.ingest>[0]
        yield* mi.ingest(typedReport)
        yield* broadcast.publishMetrics(typedReport)
        yield* alerts.evaluate(typedReport.systemId, typedReport)
      })
  }),
)
