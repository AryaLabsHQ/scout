import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Redacted } from "effect"
import { agentMayConnectAs } from "../../src/auth/http-gate.js"
import { HubConfig, isLoopbackHost } from "../../src/config.js"

const loadWith = (env: Record<string, string>) =>
  HubConfig.load.pipe(Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env })))

const refusal = (env: Record<string, string>) =>
  loadWith(env).pipe(
    Effect.flip,
    Effect.map((error) => error.message),
  )

const ACCESS_ENV = {
  SCOUT_AGENT_TOKENS: "agni=agni-secret, blaze=blaze-secret",
  SCOUT_ACCESS_TEAM_DOMAIN: "aryalabs.cloudflareaccess.com",
  SCOUT_ACCESS_AUD: "aud-tag",
}

describe("HubConfig", () => {
  it.effect("defaults to loopback, port 3001, and Cloudflare Access", () =>
    Effect.gen(function* () {
      const config = yield* loadWith(ACCESS_ENV)
      expect(config.host).toBe("127.0.0.1")
      expect(config.port).toBe(3001)
      expect([...config.agentTokens.keys()]).toEqual(["agni", "blaze"])
      expect(Redacted.value(config.agentTokens.get("blaze")!)).toBe("blaze-secret")
      expect(config.browserAuth).toEqual({
        _tag: "Access",
        teamDomain: "aryalabs.cloudflareaccess.com",
        audience: "aud-tag",
        issuer: "https://aryalabs.cloudflareaccess.com",
        certsUrl: "https://aryalabs.cloudflareaccess.com/cdn-cgi/access/certs",
      })
    }),
  )

  it.effect("normalizes a team domain given as a URL", () =>
    Effect.gen(function* () {
      const config = yield* loadWith({
        ...ACCESS_ENV,
        SCOUT_ACCESS_TEAM_DOMAIN: "https://aryalabs.cloudflareaccess.com/",
        SCOUT_HOST: "0.0.0.0",
        SCOUT_PORT: "3901",
      })
      expect(config.host).toBe("0.0.0.0")
      expect(config.port).toBe(3901)
      expect(config.browserAuth).toMatchObject({ issuer: "https://aryalabs.cloudflareaccess.com" })
    }),
  )

  it.effect("refuses to start without agent tokens, including blank ones", () =>
    Effect.gen(function* () {
      const { SCOUT_AGENT_TOKENS: _, ...withoutTokens } = ACCESS_ENV
      expect(yield* refusal(withoutTokens)).toContain("SCOUT_AGENT_TOKENS is required")
      expect(yield* refusal({ ...ACCESS_ENV, SCOUT_AGENT_TOKENS: " , " })).toContain(
        "SCOUT_AGENT_TOKENS is required",
      )
    }),
  )

  it.effect("refuses malformed, duplicate, or shared agent tokens", () =>
    Effect.gen(function* () {
      for (const value of ["agni", "agni=", "=secret", "agni=a,blaze"]) {
        expect(yield* refusal({ ...ACCESS_ENV, SCOUT_AGENT_TOKENS: value })).toContain("`hostname=token`")
      }
      expect(yield* refusal({ ...ACCESS_ENV, SCOUT_AGENT_TOKENS: "agni=a,agni=b" })).toContain(
        'hostname "agni" more than once',
      )
      expect(yield* refusal({ ...ACCESS_ENV, SCOUT_AGENT_TOKENS: "agni=same,blaze=same" })).toContain(
        "reuses a token",
      )
    }),
  )

  it.effect("binds each token to its own hostname", () =>
    Effect.gen(function* () {
      const { agentTokens } = yield* loadWith(ACCESS_ENV)
      expect(agentMayConnectAs(agentTokens, "agni", "agni-secret")).toBe(true)
      expect(agentMayConnectAs(agentTokens, "blaze", "blaze-secret")).toBe(true)
      expect(agentMayConnectAs(agentTokens, "agni", "blaze-secret")).toBe(false)
      expect(agentMayConnectAs(agentTokens, "unknown", "agni-secret")).toBe(false)
      expect(agentMayConnectAs(agentTokens, "agni", "")).toBe(false)
    }),
  )

  it.effect("refuses to start without Access settings (fail closed)", () =>
    Effect.gen(function* () {
      expect(yield* refusal({ SCOUT_AGENT_TOKENS: "local=t" })).toContain(
        "SCOUT_ACCESS_TEAM_DOMAIN and SCOUT_ACCESS_AUD",
      )
      expect(
        yield* refusal({
          SCOUT_AGENT_TOKENS: "local=t",
          SCOUT_ACCESS_TEAM_DOMAIN: "aryalabs.cloudflareaccess.com",
        }),
      ).toContain("SCOUT_ACCESS_AUD")
    }),
  )

  it.effect("allows SCOUT_AUTH=disabled only on a loopback host", () =>
    Effect.gen(function* () {
      const local = yield* loadWith({ SCOUT_AGENT_TOKENS: "local=t", SCOUT_AUTH: "disabled" })
      expect(local.browserAuth).toEqual({ _tag: "Disabled" })

      const ipv6 = yield* loadWith({
        SCOUT_AGENT_TOKENS: "local=t",
        SCOUT_AUTH: "disabled",
        SCOUT_HOST: "::1",
      })
      expect(ipv6.browserAuth._tag).toBe("Disabled")

      expect(
        yield* refusal({ SCOUT_AGENT_TOKENS: "local=t", SCOUT_AUTH: "disabled", SCOUT_HOST: "0.0.0.0" }),
      ).toContain("only allowed when SCOUT_HOST is a loopback address")
      expect(
        yield* refusal({ SCOUT_AGENT_TOKENS: "local=t", SCOUT_AUTH: "disabled", SCOUT_HOST: "100.64.0.1" }),
      ).toContain("loopback")
    }),
  )

  it.effect("rejects an unknown SCOUT_AUTH mode", () =>
    Effect.gen(function* () {
      expect(yield* refusal({ ...ACCESS_ENV, SCOUT_AUTH: "off" })).toContain(
        'SCOUT_AUTH must be "access" or "disabled"',
      )
    }),
  )

  it("recognizes loopback hosts", () => {
    expect(["127.0.0.1", "127.1.2.3", "localhost", "::1", "[::1]"].every(isLoopbackHost)).toBe(true)
    expect(["0.0.0.0", "::", "100.100.1.1", "scout.arya.sh", "127.0.0.1.nip.io"].some(isLoopbackHost)).toBe(
      false,
    )
  })
})
