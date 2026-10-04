/**
 * Hub process configuration, validated once at startup.
 *
 * The hub fails closed: it refuses to start without an agent token, and it
 * refuses to start without Cloudflare Access settings unless browser auth is
 * explicitly disabled AND the listener is bound to a loopback address.
 */

import { Config, Data, Effect, Layer, Option, Redacted } from "effect"
import * as Context from "effect/Context"

// ── Shape ────────────────────────────────────────────────────────────────────

export type BrowserAuthConfig =
  | {
      readonly _tag: "Access"
      /** Cloudflare Access team domain, e.g. `aryalabs.cloudflareaccess.com`. */
      readonly teamDomain: string
      /** Application Audience (AUD) tag of the Access application. */
      readonly audience: string
      /** Expected `iss` claim: `https://<teamDomain>`. */
      readonly issuer: string
      /** JWKS endpoint, `https://<teamDomain>/cdn-cgi/access/certs` unless overridden for tests. */
      readonly certsUrl: string
    }
  | { readonly _tag: "Disabled" }

export interface HubConfigShape {
  readonly host: string
  readonly port: number
  /** Shared secret agents present on `/ws/rpc/agent`. */
  readonly agentToken: Redacted.Redacted<string>
  readonly browserAuth: BrowserAuthConfig
}

export class HubConfigError extends Data.TaggedError("HubConfigError")<{
  readonly message: string
}> {}

// ── Validation ───────────────────────────────────────────────────────────────

export const DEFAULT_HOST = "127.0.0.1"
export const DEFAULT_PORT = 3001

export const isLoopbackHost = (host: string): boolean => {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
  return normalized === "localhost" || normalized === "::1" || /^127(\.\d{1,3}){3}$/.test(normalized)
}

/** Accept `team.cloudflareaccess.com` or `https://team.cloudflareaccess.com/`. */
const normalizeTeamDomain = (raw: string): string =>
  raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")

const optionalString = (name: string) =>
  Config.option(Config.String(name)).pipe(
    Config.map(Option.map((value) => value.trim())),
    Config.map(Option.filter((value) => value.length > 0)),
  )

const fail = (message: string) => Effect.fail(new HubConfigError({ message }))

const load: Effect.Effect<HubConfigShape, HubConfigError> = Effect.gen(function* () {
  const raw = yield* Config.all({
    host: optionalString("SCOUT_HOST"),
    port: Config.option(Config.Port("SCOUT_PORT")),
    token: optionalString("SCOUT_TOKEN"),
    auth: optionalString("SCOUT_AUTH"),
    teamDomain: optionalString("SCOUT_ACCESS_TEAM_DOMAIN"),
    audience: optionalString("SCOUT_ACCESS_AUD"),
    certsUrl: optionalString("SCOUT_ACCESS_CERTS_URL"),
  }).pipe(
    Effect.mapError(
      (error) => new HubConfigError({ message: `Invalid hub configuration: ${error.message}` }),
    ),
  )

  const host = Option.getOrElse(raw.host, () => DEFAULT_HOST)
  const port = Option.getOrElse(raw.port, () => DEFAULT_PORT)

  if (Option.isNone(raw.token)) {
    return yield* fail("SCOUT_TOKEN is required and must not be blank; agents authenticate with it.")
  }

  const authMode = Option.getOrElse(raw.auth, () => "access").toLowerCase()
  let browserAuth: BrowserAuthConfig

  if (authMode === "disabled") {
    if (!isLoopbackHost(host)) {
      return yield* fail(
        `SCOUT_AUTH=disabled is only allowed when SCOUT_HOST is a loopback address (got "${host}").`,
      )
    }
    browserAuth = { _tag: "Disabled" }
  } else if (authMode === "access") {
    if (Option.isNone(raw.teamDomain) || Option.isNone(raw.audience)) {
      return yield* fail(
        "SCOUT_ACCESS_TEAM_DOMAIN and SCOUT_ACCESS_AUD are required for browser auth. " +
          "Set both, or set SCOUT_AUTH=disabled with a loopback SCOUT_HOST for local development.",
      )
    }
    const teamDomain = normalizeTeamDomain(raw.teamDomain.value)
    browserAuth = {
      _tag: "Access",
      teamDomain,
      audience: raw.audience.value,
      issuer: `https://${teamDomain}`,
      certsUrl: Option.getOrElse(raw.certsUrl, () => `https://${teamDomain}/cdn-cgi/access/certs`),
    }
  } else {
    return yield* fail(`SCOUT_AUTH must be "access" or "disabled" (got "${authMode}").`)
  }

  return {
    host,
    port,
    agentToken: Redacted.make(raw.token.value),
    browserAuth,
  }
})

// ── Service ──────────────────────────────────────────────────────────────────

export class HubConfig extends Context.Service<HubConfig, HubConfigShape>()("@scout/HubConfig") {
  static readonly load = load
  static readonly layer = Layer.effect(this, load)
}
