import { Effect, Schema, Stream } from "effect"
import {
  ActionResultSchema,
  type ActionRequest,
  type ActionResult,
  type ActionTarget,
  type PluginPermission,
  PluginExecutionError,
  type StreamChunk,
  type StreamRequest,
} from "./schemas.js"
import type {
  ActionContext,
  ScoutActionHandler,
  ScoutPlugin,
  ScoutStreamHandler,
  StreamContext,
} from "./runtime.js"

const failExecution = (
  code: string,
  message: string,
  opts?: { pluginId?: string; actionId?: string; streamId?: string },
) =>
  new PluginExecutionError({
    code,
    message,
    ...(opts?.pluginId !== undefined && { pluginId: opts.pluginId }),
    ...(opts?.actionId !== undefined && { actionId: opts.actionId }),
    ...(opts?.streamId !== undefined && { streamId: opts.streamId }),
  })

const ensureTargetKind = (
  target: ActionTarget,
  targetKinds: ReadonlyArray<string>,
  opts: { pluginId: string; actionId?: string; streamId?: string },
): Effect.Effect<void, PluginExecutionError> => {
  const kind = target.entity?.kind
  if (kind === undefined) return Effect.void
  return targetKinds.includes(kind)
    ? Effect.void
    : Effect.fail(
        failExecution(
          "invalid-target-kind",
          `Target entity kind "${kind}" is not valid for this operation`,
          opts,
        ),
      )
}

const ensurePermissions = (
  granted: ReadonlySet<PluginPermission>,
  required: ReadonlyArray<PluginPermission>,
  opts: { pluginId: string; actionId?: string; streamId?: string },
): Effect.Effect<void, PluginExecutionError> => {
  for (const permission of required) {
    if (!granted.has(permission)) {
      return Effect.fail(
        failExecution("permission-denied", `Missing required plugin permission: ${permission}`, opts),
      )
    }
  }
  return Effect.void
}

const mapUnexpectedError = (
  error: unknown,
  opts: { pluginId: string; actionId?: string; streamId?: string },
) =>
  error instanceof PluginExecutionError
    ? error
    : failExecution("plugin-execution-failed", String(error), opts)

const findActionHandler = <E, R>(
  plugin: ScoutPlugin<E, R>,
  actionId: string,
): ScoutActionHandler<unknown, unknown, E, R> | null =>
  plugin.agent?.actions?.find(
    (candidate: ScoutActionHandler<unknown, unknown, E, R>) => candidate.definition.id === actionId,
  ) ?? null

const findStreamHandler = <E, R>(
  plugin: ScoutPlugin<E, R>,
  streamId: string,
): ScoutStreamHandler<unknown, unknown, E, R> | null =>
  plugin.agent?.streams?.find(
    (candidate: ScoutStreamHandler<unknown, unknown, E, R>) => candidate.definition.id === streamId,
  ) ?? null

export const executePluginAction = <E, R>(
  plugin: ScoutPlugin<E, R>,
  ctx: ActionContext,
  request: ActionRequest,
): Effect.Effect<ActionResult, PluginExecutionError> =>
  Effect.gen(function* () {
    if (plugin.agent === undefined) {
      return yield* Effect.fail(
        failExecution("runtime-missing", "Plugin has no agent runtime", {
          pluginId: plugin.manifest.id,
          actionId: request.actionId,
        }),
      )
    }

    if (request.pluginId !== plugin.manifest.id) {
      return yield* Effect.fail(
        failExecution(
          "plugin-mismatch",
          `Action request targets plugin "${request.pluginId}" but package is "${plugin.manifest.id}"`,
          { pluginId: plugin.manifest.id, actionId: request.actionId },
        ),
      )
    }

    const handler = findActionHandler(plugin, request.actionId)
    if (handler === null) {
      return yield* Effect.fail(
        failExecution("action-not-found", `Unknown plugin action "${request.actionId}"`, {
          pluginId: plugin.manifest.id,
          actionId: request.actionId,
        }),
      )
    }

    yield* ensureTargetKind(request.target, handler.definition.targetKinds, {
      pluginId: plugin.manifest.id,
      actionId: request.actionId,
    })
    yield* ensurePermissions(ctx.permissions, handler.definition.permissions, {
      pluginId: plugin.manifest.id,
      actionId: request.actionId,
    })

    const input = yield* Schema.decodeUnknownEffect(handler.inputSchema)(request.input ?? {}).pipe(
      Effect.mapError((error) =>
        failExecution("invalid-action-input", String(error), {
          pluginId: plugin.manifest.id,
          actionId: request.actionId,
        }),
      ),
    )

    const rawOutput = yield* handler.execute(ctx, request.target, input).pipe(
      Effect.mapError((error) =>
        mapUnexpectedError(error, {
          pluginId: plugin.manifest.id,
          actionId: request.actionId,
        }),
      ),
    )

    const output = yield* Schema.decodeUnknownEffect(handler.outputSchema)(rawOutput).pipe(
      Effect.mapError((error) =>
        failExecution("invalid-action-output", String(error), {
          pluginId: plugin.manifest.id,
          actionId: request.actionId,
        }),
      ),
    )

    return yield* Schema.decodeUnknownEffect(ActionResultSchema)({
      success: true,
      output,
    }).pipe(
      Effect.mapError((error) =>
        failExecution("invalid-action-result", String(error), {
          pluginId: plugin.manifest.id,
          actionId: request.actionId,
        }),
      ),
    )
  }) as Effect.Effect<ActionResult, PluginExecutionError>

export const openPluginStream = <E, R>(
  plugin: ScoutPlugin<E, R>,
  ctx: StreamContext,
  request: StreamRequest,
): Effect.Effect<Stream.Stream<StreamChunk, PluginExecutionError>, PluginExecutionError> =>
  Effect.gen(function* () {
    if (plugin.agent === undefined) {
      return yield* Effect.fail(
        failExecution("runtime-missing", "Plugin has no agent runtime", {
          pluginId: plugin.manifest.id,
          streamId: request.streamId,
        }),
      )
    }

    if (request.pluginId !== plugin.manifest.id) {
      return yield* Effect.fail(
        failExecution(
          "plugin-mismatch",
          `Stream request targets plugin "${request.pluginId}" but package is "${plugin.manifest.id}"`,
          { pluginId: plugin.manifest.id, streamId: request.streamId },
        ),
      )
    }

    const handler = findStreamHandler(plugin, request.streamId)
    if (handler === null) {
      return yield* Effect.fail(
        failExecution("stream-not-found", `Unknown plugin stream "${request.streamId}"`, {
          pluginId: plugin.manifest.id,
          streamId: request.streamId,
        }),
      )
    }

    yield* ensureTargetKind(request.target, handler.definition.targetKinds, {
      pluginId: plugin.manifest.id,
      streamId: request.streamId,
    })
    yield* ensurePermissions(ctx.permissions, handler.definition.permissions, {
      pluginId: plugin.manifest.id,
      streamId: request.streamId,
    })

    const input = yield* Schema.decodeUnknownEffect(handler.inputSchema)(request.input ?? {}).pipe(
      Effect.mapError((error) =>
        failExecution("invalid-stream-input", String(error), {
          pluginId: plugin.manifest.id,
          streamId: request.streamId,
        }),
      ),
    )

    const rawStream = handler.open(ctx, request.target, input).pipe(
      Stream.mapError((error) =>
        mapUnexpectedError(error, {
          pluginId: plugin.manifest.id,
          streamId: request.streamId,
        }),
      ),
    )

    return rawStream.pipe(
      Stream.mapEffect((chunk) =>
        Schema.decodeUnknownEffect(handler.chunkSchema)(chunk).pipe(
          Effect.mapError((error) =>
            failExecution("invalid-stream-chunk", String(error), {
              pluginId: plugin.manifest.id,
              streamId: request.streamId,
            }),
          ),
        ),
      ),
    ) as Stream.Stream<StreamChunk, PluginExecutionError>
  }) as Effect.Effect<Stream.Stream<StreamChunk, PluginExecutionError>, PluginExecutionError>
