import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { and, desc, eq, gte, max } from "drizzle-orm"
import type { CoreMetricsPayload, SystemMetricsSample } from "@scout/shared"
import { CoreMetricsPayloadSchema } from "@scout/shared"
import { Schema } from "effect"
import type { EntitySnapshot, EventRecord, MetricPoint, PluginCollectionResult } from "@scout/plugin-sdk"
import { Database, type ScoutDatabase } from "./database.js"
import * as schema from "../../drizzle/schema.js"
import { SchemaValidationError } from "../lib/errors.js"

const upsertSystem = (db: ScoutDatabase, systemId: string, timestamp: number): void => {
  const now = new Date(timestamp)

  db.insert(schema.systems)
    .values({
      id: systemId,
      hostname: systemId,
      status: "online",
      lastSeen: now,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: schema.systems.id,
      set: {
        status: "online",
        lastSeen: now,
      },
    })
    .run()
}

const entityKey = (entity: EntitySnapshot): string =>
  [entity.ref.nodeId, entity.ref.pluginId, entity.ref.kind, entity.ref.id].join(":")

const persistPluginCollection = (
  db: ScoutDatabase,
  systemId: string,
  collection: PluginCollectionResult,
): void => {
  for (const entity of collection.entities ?? []) {
    db.insert(schema.pluginEntities)
      .values({
        key: entityKey(entity),
        systemId,
        pluginId: entity.ref.pluginId,
        kind: entity.ref.kind,
        entityId: entity.ref.id,
        observedAt: new Date(entity.ts),
        displayName: entity.displayName ?? null,
        status: entity.status ?? null,
        labels: entity.labels ?? null,
        spec: entity.spec ?? null,
        state: entity.state ?? null,
        relationships: entity.relationships ?? null,
      })
      .onConflictDoUpdate({
        target: schema.pluginEntities.key,
        set: {
          observedAt: new Date(entity.ts),
          displayName: entity.displayName ?? null,
          status: entity.status ?? null,
          labels: entity.labels ?? null,
          spec: entity.spec ?? null,
          state: entity.state ?? null,
          relationships: entity.relationships ?? null,
        },
      })
      .run()
  }

  if ((collection.metrics ?? []).length > 0) {
    db.insert(schema.pluginMetricPoints)
      .values(
        (collection.metrics ?? []).map((point) => ({
          systemId,
          pluginId: point.pluginId,
          metricId: point.metricId,
          timestamp: new Date(point.ts),
          entityKind: point.entity?.kind ?? null,
          entityId: point.entity?.id ?? null,
          value: point.value,
          unit: point.unit ?? null,
          tags: point.tags ?? null,
        })),
      )
      .run()
  }

  if ((collection.events ?? []).length === 0) {
    return
  }

  db.insert(schema.pluginEvents)
    .values(
      (collection.events ?? []).map((event) => ({
        systemId,
        pluginId: event.pluginId,
        eventId: event.eventId,
        timestamp: new Date(event.ts),
        entityKind: event.entity?.kind ?? null,
        entityId: event.entity?.id ?? null,
        severity: event.severity,
        message: event.message ?? null,
        payload: event.payload ?? null,
      })),
    )
    .run()
}

export class MetricsIngestion extends Context.Service<
  MetricsIngestion,
  {
    readonly ingest: (payload: CoreMetricsPayload) => Effect.Effect<number>
    readonly ingestRaw: (raw: unknown) => Effect.Effect<number, SchemaValidationError>
    readonly ingestPluginCollection: (
      systemId: string,
      collection: PluginCollectionResult,
    ) => Effect.Effect<void>
    readonly querySystemMetrics: (
      systemId: string,
      hours: number,
      type?: (typeof schema.systemMetrics.$inferSelect)["type"],
    ) => Effect.Effect<Array<typeof schema.systemMetrics.$inferSelect>>
    readonly queryLatest: (systemId: string) => Effect.Effect<SystemMetricsSample | null>
    readonly queryPluginEntities: (
      systemId: string,
      pluginId: string,
      kind?: string,
    ) => Effect.Effect<ReadonlyArray<EntitySnapshot>>
    readonly queryPluginMetricPoints: (
      systemId: string,
      pluginId: string,
      hours: number,
      metricId?: string,
    ) => Effect.Effect<ReadonlyArray<MetricPoint>>
    readonly queryPluginEvents: (
      systemId: string,
      pluginId: string,
      hours: number,
      eventId?: string,
    ) => Effect.Effect<ReadonlyArray<EventRecord>>
  }
>()("@scout/MetricsIngestion", {
  make: Effect.gen(function* () {
    const db = yield* Database

    const ingestPluginCollection = (
      systemId: string,
      collection: PluginCollectionResult,
    ): Effect.Effect<void> =>
      Effect.sync(() => {
        const timestamps = [
          ...(collection.entities ?? []).map((entity) => entity.ts),
          ...(collection.metrics ?? []).map((metric) => metric.ts),
          ...(collection.events ?? []).map((event) => event.ts),
        ]
        const observedAt = timestamps.length > 0 ? Math.max(...timestamps) : Date.now()
        upsertSystem(db, systemId, observedAt)
        persistPluginCollection(db, systemId, collection)
      })

    const ingest = (payload: CoreMetricsPayload): Effect.Effect<number> =>
      Effect.sync(() => {
        upsertSystem(db, payload.systemId, payload.sample.timestamp)

        db.insert(schema.systemMetrics)
          .values({
            systemId: payload.systemId,
            timestamp: new Date(payload.sample.timestamp),
            type: "1m",
            data: payload.sample as unknown as Record<string, unknown>,
          })
          .run()

        return payload.sample.timestamp
      })

    const ingestRaw = (raw: unknown): Effect.Effect<number, SchemaValidationError> =>
      Schema.decodeUnknownEffect(CoreMetricsPayloadSchema)(raw).pipe(
        Effect.mapError(
          (e) =>
            new SchemaValidationError({
              message: "Invalid CoreMetrics payload",
              errors: e,
            }),
        ),
        Effect.flatMap((decoded) => ingest(decoded as CoreMetricsPayload)),
      )

    const querySystemMetrics = (
      systemId: string,
      hours: number,
      type: (typeof schema.systemMetrics.$inferSelect)["type"] = "1m",
    ): Effect.Effect<Array<typeof schema.systemMetrics.$inferSelect>> =>
      Effect.sync(() => {
        const since = new Date(Date.now() - hours * 60 * 60 * 1000)
        return db
          .select()
          .from(schema.systemMetrics)
          .where(
            and(
              eq(schema.systemMetrics.systemId, systemId),
              eq(schema.systemMetrics.type, type),
              gte(schema.systemMetrics.timestamp, since),
            ),
          )
          .orderBy(schema.systemMetrics.timestamp)
          .all()
      })

    const queryLatest = (systemId: string): Effect.Effect<SystemMetricsSample | null> =>
      Effect.sync(() => {
        const row = db
          .select()
          .from(schema.systemMetrics)
          .where(and(eq(schema.systemMetrics.systemId, systemId), eq(schema.systemMetrics.type, "1m")))
          .orderBy(desc(schema.systemMetrics.timestamp))
          .limit(1)
          .all()

        if (row.length === 0) return null
        return row[0].data as unknown as SystemMetricsSample
      })

    const queryPluginEntities = (
      systemId: string,
      pluginId: string,
      kind?: string,
    ): Effect.Effect<ReadonlyArray<EntitySnapshot>> =>
      Effect.sync(() => {
        // A collection reports every entity the plugin currently sees, all with the
        // collection's timestamp, and rows are upserted, never deleted. Only rows
        // from the plugin's latest collection still exist on the node; older rows
        // are units, pods, or containers that have since disappeared.
        const latest = db
          .select({ observedAt: max(schema.pluginEntities.observedAt) })
          .from(schema.pluginEntities)
          .where(
            and(eq(schema.pluginEntities.systemId, systemId), eq(schema.pluginEntities.pluginId, pluginId)),
          )
          .get()?.observedAt
        if (latest === null || latest === undefined) return []

        const rows = db
          .select()
          .from(schema.pluginEntities)
          .where(
            and(
              eq(schema.pluginEntities.systemId, systemId),
              eq(schema.pluginEntities.pluginId, pluginId),
              gte(schema.pluginEntities.observedAt, latest),
              ...(kind === undefined ? [] : [eq(schema.pluginEntities.kind, kind)]),
            ),
          )
          .all()

        return rows
          .map((row) => ({
            ref: {
              pluginId: row.pluginId,
              kind: row.kind,
              nodeId: row.systemId,
              id: row.entityId,
            },
            ts: row.observedAt.getTime(),
            ...(row.displayName !== null && { displayName: row.displayName }),
            ...(row.status !== null && { status: row.status }),
            ...(row.labels !== null && { labels: row.labels as Record<string, string> }),
            ...(row.spec !== null && { spec: row.spec }),
            ...(row.state !== null && { state: row.state }),
            ...(row.relationships !== null && {
              relationships: row.relationships as EntitySnapshot["relationships"],
            }),
          }))
          .sort((a, b) =>
            a.ref.kind === b.ref.kind
              ? a.ref.id.localeCompare(b.ref.id)
              : a.ref.kind.localeCompare(b.ref.kind),
          )
      })

    const queryPluginMetricPoints = (
      systemId: string,
      pluginId: string,
      hours: number,
      metricId?: string,
    ): Effect.Effect<ReadonlyArray<MetricPoint>> =>
      Effect.sync(() => {
        const since = new Date(Date.now() - hours * 60 * 60 * 1000)
        const rows = db
          .select()
          .from(schema.pluginMetricPoints)
          .where(
            metricId === undefined
              ? and(
                  eq(schema.pluginMetricPoints.systemId, systemId),
                  eq(schema.pluginMetricPoints.pluginId, pluginId),
                  gte(schema.pluginMetricPoints.timestamp, since),
                )
              : and(
                  eq(schema.pluginMetricPoints.systemId, systemId),
                  eq(schema.pluginMetricPoints.pluginId, pluginId),
                  eq(schema.pluginMetricPoints.metricId, metricId),
                  gte(schema.pluginMetricPoints.timestamp, since),
                ),
          )
          .orderBy(schema.pluginMetricPoints.timestamp)
          .all()

        return rows.map((row) => ({
          pluginId: row.pluginId,
          metricId: row.metricId,
          ts: row.timestamp.getTime(),
          ...(row.entityKind !== null &&
            row.entityId !== null && {
              entity: {
                pluginId: row.pluginId,
                kind: row.entityKind,
                nodeId: row.systemId,
                id: row.entityId,
              },
            }),
          value: row.value,
          ...(row.unit !== null && { unit: row.unit }),
          ...(row.tags !== null && { tags: row.tags as Record<string, string> }),
        }))
      })

    const queryPluginEvents = (
      systemId: string,
      pluginId: string,
      hours: number,
      eventId?: string,
    ): Effect.Effect<ReadonlyArray<EventRecord>> =>
      Effect.sync(() => {
        const since = new Date(Date.now() - hours * 60 * 60 * 1000)
        const rows = db
          .select()
          .from(schema.pluginEvents)
          .where(
            eventId === undefined
              ? and(
                  eq(schema.pluginEvents.systemId, systemId),
                  eq(schema.pluginEvents.pluginId, pluginId),
                  gte(schema.pluginEvents.timestamp, since),
                )
              : and(
                  eq(schema.pluginEvents.systemId, systemId),
                  eq(schema.pluginEvents.pluginId, pluginId),
                  eq(schema.pluginEvents.eventId, eventId),
                  gte(schema.pluginEvents.timestamp, since),
                ),
          )
          .orderBy(schema.pluginEvents.timestamp)
          .all()

        return rows.map((row) => ({
          pluginId: row.pluginId,
          eventId: row.eventId,
          ts: row.timestamp.getTime(),
          ...(row.entityKind !== null &&
            row.entityId !== null && {
              entity: {
                pluginId: row.pluginId,
                kind: row.entityKind,
                nodeId: row.systemId,
                id: row.entityId,
              },
            }),
          severity: row.severity,
          ...(row.message !== null && { message: row.message }),
          ...(row.payload !== null && { payload: row.payload }),
        }))
      })

    return {
      ingest,
      ingestRaw,
      ingestPluginCollection,
      querySystemMetrics,
      queryLatest,
      queryPluginEntities,
      queryPluginMetricPoints,
      queryPluginEvents,
    }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
