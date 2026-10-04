/**
 * Browser RPC authentication and audit.
 *
 * Implements the shared `ClientAuthMiddleware` for `ClientHubRpcs`. The
 * websocket upgrade already passed `HttpAuthGate`; the RPC server copies the
 * upgrade request's headers onto every RPC, so each call re-verifies the
 * Access JWT (rejecting calls once it expires), provides `CurrentIdentity` to
 * the handler, and logs who invoked every RPC that can change state.
 */

import { Effect, Layer } from "effect"
import type * as Rpc from "effect/rpc/Rpc"
import type * as RpcGroup from "effect/rpc/RpcGroup"
import {
  ClientAuthMiddleware,
  CurrentIdentity,
  Unauthorized,
  type ClientHubRpcs,
  type Identity,
} from "@scout/shared"
import { BrowserAuth } from "../auth/browser-auth.js"

type ClientRpcTag = Rpc.Tag<RpcGroup.Rpcs<typeof ClientHubRpcs>>

/**
 * RPCs that only read state. Everything else is audited, so a new RPC is
 * audited until someone deliberately lists it here. `terminal.input` and
 * `terminal.resize` act inside a session whose `terminal.open` was audited;
 * logging keystrokes would leak secrets.
 */
const UNAUDITED_RPCS: ReadonlySet<ClientRpcTag> = new Set<ClientRpcTag>([
  "systems.list",
  "systems.get",
  "systems.metrics",
  "operator.sessions.list",
  "operator.sessions.get",
  "operator.skills.list",
  "operator.models.list",
  "alerts.list",
  "alertRules.list",
  "metrics.subscribe",
  "alerts.subscribe",
  "systems.subscribe",
  "operator.events.subscribe",
  "plugins.logs",
  "terminal.input",
  "terminal.resize",
])

/** Identifier-like payload fields safe to log; free text and terminal data are never logged. */
const AUDIT_FIELDS = [
  "id",
  "agentId",
  "pluginId",
  "actionId",
  "alertId",
  "sessionId",
  "approvalId",
  "decision",
  "mode",
] as const

const auditTarget = (payload: unknown): Record<string, string> => {
  if (typeof payload !== "object" || payload === null) return {}
  const record = payload as Record<string, unknown>
  const target: Record<string, string> = {}
  for (const field of AUDIT_FIELDS) {
    const value = record[field]
    if (typeof value === "string" || typeof value === "number") target[field] = String(value)
  }
  const entity = record["entity"] as { readonly kind?: unknown; readonly id?: unknown } | undefined
  if (typeof entity?.id === "string") target["entity"] = `${String(entity.kind)}/${entity.id}`
  return target
}

export const actorOf = (identity: Identity): string => identity.email ?? identity.subject

export const ClientAuthMiddlewareLive = Layer.effect(
  ClientAuthMiddleware,
  Effect.gen(function* () {
    const browserAuth = yield* BrowserAuth

    return ClientAuthMiddleware.of((effect, { rpc, payload, headers }) =>
      Effect.gen(function* () {
        const identity = yield* browserAuth.authenticate(headers).pipe(
          Effect.mapError((error) => new Unauthorized({ message: error.message })),
        )
        const actor = actorOf(identity)

        if (!UNAUDITED_RPCS.has(rpc._tag as ClientRpcTag)) {
          yield* Effect.logInfo("rpc audit").pipe(
            Effect.annotateLogs({
              rpc: rpc._tag,
              actor,
              identitySource: identity.source,
              ...auditTarget(payload),
            }),
          )
        }

        return yield* effect.pipe(
          Effect.provideService(CurrentIdentity, identity),
          Effect.annotateLogs({ actor }),
        )
      }),
    )
  }),
)
