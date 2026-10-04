/**
 * Browser authentication for the hub's `/api/*` routes and `/ws/rpc`.
 *
 * In `Access` mode every request must carry a Cloudflare Access JWT, read from
 * the `Cf-Access-Jwt-Assertion` header and falling back to the
 * `CF_Authorization` cookie. In `Disabled` mode (loopback-only, enforced by
 * `HubConfig`) every request acts as the local development identity.
 */

import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import * as Cookies from "effect/http/Cookies"
import type * as Headers from "effect/http/Headers"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import type { Identity } from "@scout/shared"
import { HubConfig } from "../config.js"
import {
  AccessJwtError,
  makeAccessJwtVerifier,
  makeAccessKeyStore,
  type AccessJwtVerifier,
  type Authenticated,
  type FetchJwks,
} from "./access-jwt.js"

export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion"
export const ACCESS_JWT_COOKIE = "CF_Authorization"

export const LOCAL_DEV_IDENTITY: Identity = {
  source: "auth-disabled",
  subject: "local-dev",
  email: null,
}

/** Header first, then the `CF_Authorization` cookie; `null` when neither is present. */
export const accessTokenFromHeaders = (headers: Headers.Headers): string | null => {
  const header = headers[ACCESS_JWT_HEADER]?.trim()
  if (header) return header
  const cookieHeader = headers["cookie"]
  if (cookieHeader) {
    const cookie = Cookies.parseHeader(cookieHeader)[ACCESS_JWT_COOKIE]?.trim()
    if (cookie) return cookie
  }
  return null
}

export interface BrowserAuthShape {
  readonly authenticate: (headers: Headers.Headers) => Effect.Effect<Authenticated, AccessJwtError>
}

export class BrowserAuth extends Context.Service<BrowserAuth, BrowserAuthShape>()("@scout/BrowserAuth") {
  /** Authenticate with an explicit verifier; used by `layer` and by tests. */
  static readonly fromVerifier = (verify: AccessJwtVerifier): BrowserAuthShape => ({
    authenticate: (headers) => {
      const token = accessTokenFromHeaders(headers)
      return token === null
        ? Effect.fail(
            new AccessJwtError({
              reason: "missing-token",
              message: `Missing ${ACCESS_JWT_HEADER} header or ${ACCESS_JWT_COOKIE} cookie`,
            }),
          )
        : verify(token)
    },
  })

  static readonly disabled: BrowserAuthShape = {
    authenticate: () => Effect.succeed({ identity: LOCAL_DEV_IDENTITY, expiresAt: null }),
  }

  /** Requires `HubConfig` and, in Access mode, an `HttpClient` for the JWKS. */
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* HubConfig
      const auth = config.browserAuth
      if (auth._tag === "Disabled") {
        yield* Effect.logWarning("Browser auth DISABLED (SCOUT_AUTH=disabled); loopback-only development mode")
        return BrowserAuth.disabled
      }

      const client = yield* HttpClient.HttpClient
      const fetchJwks: FetchJwks = client.get(auth.certsUrl).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.json),
        Effect.timeout("10 seconds"),
        Effect.mapError(
          (error) =>
            new AccessJwtError({
              reason: "jwks-unavailable",
              message: `Could not fetch Access signing keys from ${auth.certsUrl}: ${String(error)}`,
            }),
        ),
        Effect.tapError((error) => Effect.logWarning(error.message)),
      )

      const keys = yield* makeAccessKeyStore({ fetchJwks })
      yield* Effect.logInfo("Browser auth: Cloudflare Access", {
        teamDomain: auth.teamDomain,
        issuer: auth.issuer,
      })
      return BrowserAuth.fromVerifier(
        makeAccessJwtVerifier({ issuer: auth.issuer, audience: auth.audience, keys }),
      )
    }),
  )
}
