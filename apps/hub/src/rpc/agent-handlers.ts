/**
 * AgentHubRpcs handler implementations.
 *
 * These are the hub-side handlers for RPCs initiated by agents (agent→hub
 * direction). In Phase B no agents connect via the new /ws/rpc/agent
 * endpoint, but the layer is wired here so Phase C has something to plug into.
 */

import { Effect } from "effect"
import { AgentHubRpcs } from "@scout/shared"
import { MetricsIngestion } from "../services/metrics-ingestion.js"
import { MetricsBroadcast } from "../services/metrics-broadcast.js"
import { AlertEngine } from "../services/alert-engine.js"

export const AgentHandlersLive = AgentHubRpcs.toLayer(
  Effect.gen(function* () {
    const mi = yield* MetricsIngestion
    const broadcast = yield* MetricsBroadcast
    const alerts = yield* AlertEngine

    return AgentHubRpcs.of({
      /**
       * agent.connect — validate token and acknowledge.
       *
       * Phase C will add SCOUT_TOKEN verification here. For now, any
       * connection that reaches this handler has already passed the
       * transport-level check in the bridge.
       */
      "agent.connect": ({ hostname, token: _token, version: _version, platform: _platform, capabilities: _capabilities }) =>
        Effect.gen(function* () {
          yield* Effect.logInfo("agent.connect received").pipe(
            Effect.annotateLogs({ hostname }),
          )
          return { systemId: hostname }
        }),

      /**
       * agent.report — persist metrics and fan-out to subscribers.
       */
      "agent.report": (report) =>
        Effect.gen(function* () {
          const typedReport = report as Parameters<typeof mi.ingest>[0]
          yield* mi.ingest(typedReport)
          yield* broadcast.publishMetrics(typedReport)
          yield* alerts.evaluate(typedReport.systemId, typedReport)
        }),
    })
  }),
)
