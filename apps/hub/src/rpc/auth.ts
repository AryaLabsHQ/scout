/**
 * Auth middleware for the ClientHubRpcs server.
 *
 * Reads a Bearer token from the `authorization` header and compares it
 * against `SCOUT_TOKEN` from the environment. Rejects with `Unauthorized`
 * when the token is absent or mismatched.
 */

import { Config, Effect, Layer, Schema } from "effect"
import * as RpcMiddleware from "effect/rpc/RpcMiddleware"

// ── Error type ────────────────────────────────────────────────────────────────

export class Unauthorized extends Schema.Error<Unauthorized>("Unauthorized")({
  _tag: Schema.tag("Unauthorized"),
  message: Schema.String,
}) {}

// ── Middleware service ────────────────────────────────────────────────────────

export class AuthMiddleware extends RpcMiddleware.Service<AuthMiddleware>()(
  "scout/AuthMiddleware",
  {
    error: Unauthorized,
    requiredForClient: true,
  },
) {}

// ── Live implementation ───────────────────────────────────────────────────────

export const AuthMiddlewareLive =
  Layer.effect(
    AuthMiddleware,
    Effect.gen(function* () {
      // Read once at layer construction time — no per-request Config.string call
      const expectedToken = yield* Config.String("SCOUT_TOKEN")

      return AuthMiddleware.of((effect, options) => {
        const authHeader = options.headers["authorization"] as string | undefined

        // Accept "Bearer <token>" or a bare token
        const provided = authHeader?.startsWith("Bearer ")
          ? authHeader.slice(7)
          : authHeader

        if (!provided || provided !== expectedToken) {
          return Effect.fail(
            new Unauthorized({ message: "Invalid or missing SCOUT_TOKEN" }),
          ) as never
        }

        return effect
      })
    }),
  )
