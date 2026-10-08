/**
 * Global HTTP authentication gate for the hub.
 *
 * Runs before route matching, so it also covers websocket upgrades and
 * unknown paths (fail closed):
 *
 *   /health          open (liveness probes, no data beyond counts)
 *   /ws/rpc/agent    an agent token: `Authorization: Bearer <token>`
 *   everything else  browser identity via `BrowserAuth` (Cloudflare Access)
 */

import { timingSafeEqual, createHash } from "node:crypto"
import { Effect, Option, Redacted } from "effect"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import { HubConfig } from "../config.js"
import { BrowserAuth } from "./browser-auth.js"

export const OPEN_PATHS: ReadonlySet<string> = new Set(["/health"])
export const AGENT_RPC_PATH = "/ws/rpc/agent"

const digest = (value: string) => createHash("sha256").update(value).digest()

/** Constant-time comparison of a presented token against one agent's token. */
export const agentTokenEquals = (presented: string, expected: Redacted.Redacted<string>): boolean =>
  presented.length > 0 && timingSafeEqual(digest(presented), digest(Redacted.value(expected)))

/**
 * Checks an `Authorization: Bearer <token>` header against every agent's token.
 * The upgrade only needs some valid token; `agent.connect` then binds the
 * connection to the hostname that token belongs to.
 */
export const agentTokenMatches = (
  authorization: string | undefined,
  tokens: ReadonlyMap<string, Redacted.Redacted<string>>,
): boolean => {
  const presented = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? ""
  let matched = false
  for (const expected of tokens.values()) {
    if (agentTokenEquals(presented, expected)) matched = true
  }
  return matched
}

/** True when `token` is the token configured for `hostname`. */
export const agentMayConnectAs = (
  tokens: ReadonlyMap<string, Redacted.Redacted<string>>,
  hostname: string,
  token: string,
): boolean => {
  const expected = tokens.get(hostname)
  return expected !== undefined && agentTokenEquals(token, expected)
}

const pathOf = (request: HttpServerRequest.HttpServerRequest): string => {
  const queryStart = request.url.indexOf("?")
  return queryStart === -1 ? request.url : request.url.slice(0, queryStart)
}

const unauthorized = (status: 401 | 503, error: string) =>
  HttpServerResponse.jsonUnsafe({ error }, { status })

export const HttpAuthGate = HttpRouter.middleware(
  Effect.gen(function* () {
    const config = yield* HubConfig
    const browserAuth = yield* BrowserAuth

    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const path = pathOf(request)

        if (OPEN_PATHS.has(path)) return yield* httpEffect

        if (path === AGENT_RPC_PATH) {
          if (!agentTokenMatches(request.headers["authorization"], config.agentTokens)) {
            yield* Effect.logWarning("agent upgrade rejected: missing or invalid token", {
              remote: Option.getOrUndefined(request.remoteAddress),
            })
            return unauthorized(401, "invalid-agent-token")
          }
          return yield* httpEffect
        }

        const result = yield* Effect.result(browserAuth.authenticate(request.headers))
        if (result._tag === "Failure") {
          const failure = result.failure
          yield* Effect.logInfo("request rejected", { path, reason: failure.reason })
          return failure.reason === "jwks-unavailable"
            ? unauthorized(503, failure.reason)
            : unauthorized(401, failure.reason)
        }
        return yield* httpEffect
      })
  }),
  { global: true },
)
