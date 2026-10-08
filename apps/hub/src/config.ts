/**
 * Hub process configuration, validated once at startup.
 *
 * The hub fails closed: it refuses to start without agent tokens, and it
 * refuses to start without Cloudflare Access settings unless browser auth is
 * explicitly disabled AND the listener is bound to a loopback address.
 */

import { Config, Data, Effect, Layer, Option, Redacted } from "effect"
import * as Context from "effect/Context"

// ── Shape ────────────────────────────────────────────────────────────────────

export type BrowserAuthConfig =
  | {
      readonly _tag: "Access"
      /** Cloudflare Access team domain, e.g. `your-team.cloudflareaccess.com`. */
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
  /**
   * Agent tokens keyed by hostname. An agent presents its own token on
   * `/ws/rpc/agent` and may connect only as the hostname that token belongs to.
   */
  readonly agentTokens: ReadonlyMap<string, Redacted.Redacted<string>>
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

/**
 * Parses `SCOUT_AGENT_TOKENS`: comma-separated `hostname=token` entries. Every
 * hostname and token must be non-blank and unique, so a token identifies
 * exactly one machine.
 */
export const parseAgentTokens = (
  raw: string,
): Effect.Effect<ReadonlyMap<string, Redacted.Redacted<string>>, HubConfigError> =>
  Effect.gen(function* () {
    const tokens = new Map<string, Redacted.Redacted<string>>()
    const seen = new Set<string>()
    for (const entry of raw.split(",")) {
      if (entry.trim().length === 0) continue
      const separator = entry.indexOf("=")
      const hostname = separator === -1 ? "" : entry.slice(0, separator).trim()
      const token = separator === -1 ? "" : entry.slice(separator + 1).trim()
      if (hostname.length === 0 || token.length === 0) {
        return yield* fail("SCOUT_AGENT_TOKENS entries must be `hostname=token` with both parts non-blank.")
      }
      if (tokens.has(hostname)) {
        return yield* fail(`SCOUT_AGENT_TOKENS lists hostname "${hostname}" more than once.`)
      }
      if (seen.has(token)) {
        return yield* fail("SCOUT_AGENT_TOKENS reuses a token; give every agent its own.")
      }
      seen.add(token)
      tokens.set(hostname, Redacted.make(token))
    }
    if (tokens.size === 0) {
      return yield* fail(
        "SCOUT_AGENT_TOKENS is required and must list at least one `hostname=token`; agents authenticate with it.",
      )
    }
    return tokens
  })

const load: Effect.Effect<HubConfigShape, HubConfigError> = Effect.gen(function* () {
  const raw = yield* Config.all({
    host: optionalString("SCOUT_HOST"),
    port: Config.option(Config.Port("SCOUT_PORT")),
    agentTokens: optionalString("SCOUT_AGENT_TOKENS"),
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

  const agentTokens = yield* parseAgentTokens(Option.getOrElse(raw.agentTokens, () => ""))

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
    agentTokens,
    browserAuth,
  }
})

// ── Service ──────────────────────────────────────────────────────────────────

export class HubConfig extends Context.Service<HubConfig, HubConfigShape>()("@scout/HubConfig") {
  static readonly load = load
  static readonly layer = Layer.effect(this, load)
}
