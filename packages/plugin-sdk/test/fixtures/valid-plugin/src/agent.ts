import { Effect, Schema, Stream } from "effect"
import type {
  CollectContext,
  ScoutAgentPlugin,
  StreamContext,
} from "../../../../src/index.js"
import { defineAgent } from "../../../../src/index.js"

export const agent = defineAgent({
  detect: ({ now, nodeId }: CollectContext) =>
    Effect.succeed({
      pluginId: "fixture-valid",
      version: "0.1.0",
      status: "available" as const,
      features: [nodeId, String(now)],
    }),
  collect: ({ now, nodeId }: CollectContext) =>
    Effect.succeed({
      entities: [
        {
          ref: {
            pluginId: "fixture-valid",
            kind: "thing",
            nodeId,
            id: "fixture-1",
          },
          ts: now,
          displayName: "Fixture Thing",
          status: "ok",
        },
      ],
      metrics: [
        {
          pluginId: "fixture-valid",
          metricId: "thing.count",
          ts: now,
          value: 1,
        },
      ],
    }),
  actions: [
    {
      definition: {
        id: "refresh",
        displayName: "Refresh",
        targetKinds: ["thing"],
        permissions: ["node:read-files"],
        requiresConfirmation: false,
      },
      inputSchema: Schema.Struct({}),
      outputSchema: Schema.Struct({
        refreshed: Schema.Boolean,
      }),
      execute: () => Effect.succeed({ refreshed: true }),
    },
  ],
  streams: [
    {
      definition: {
        id: "events",
        displayName: "Events",
        kind: "events",
        targetKinds: ["thing"],
        permissions: ["node:read-files"],
      },
      inputSchema: Schema.Struct({}),
      chunkSchema: Schema.Struct({
        event: Schema.Struct({
          pluginId: Schema.String,
          eventId: Schema.String,
          ts: Schema.Number,
          severity: Schema.Literals(["info", "warning", "error"]),
          entity: Schema.optionalKey(
            Schema.Struct({
              pluginId: Schema.String,
              kind: Schema.String,
              nodeId: Schema.String,
              id: Schema.String,
            }),
          ),
          message: Schema.optionalKey(Schema.String),
          payload: Schema.optionalKey(Schema.Unknown),
        }),
      }),
      open: ({ nodeId }: StreamContext) =>
        Stream.make({
          event: {
            pluginId: "fixture-valid",
            eventId: "thing.updated",
            ts: Date.now(),
            severity: "info",
            entity: {
              pluginId: "fixture-valid",
              kind: "thing",
              nodeId,
              id: "fixture-1",
            },
            message: "Fixture event",
          },
        }),
    },
  ],
} satisfies ScoutAgentPlugin)
