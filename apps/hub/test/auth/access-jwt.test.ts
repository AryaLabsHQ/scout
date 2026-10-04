import { describe, expect, it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import * as Headers from "effect/http/Headers"
import * as TestClock from "effect/testing/TestClock"
import {
  AccessJwtError,
  makeAccessJwtVerifier,
  makeAccessKeyStore,
} from "../../src/auth/access-jwt.js"
import { BrowserAuth, LOCAL_DEV_IDENTITY } from "../../src/auth/browser-auth.js"
import {
  TEST_AUD,
  TEST_EMAIL,
  TEST_ISSUER,
  accessClaims,
  jwksOf,
  makeTestSigner,
  type TestSigner,
} from "../helpers/access-jwt.js"

const signerA = await makeTestSigner("key-a")
const signerB = await makeTestSigner("key-b")

/** A verifier over a mutable fake JWKS endpoint that counts fetches. */
const makeHarness = (initial: ReadonlyArray<TestSigner>) =>
  Effect.gen(function* () {
    const published = yield* Ref.make(initial)
    const fetches = yield* Ref.make(0)
    const keys = yield* makeAccessKeyStore({
      fetchJwks: Ref.update(fetches, (n) => n + 1).pipe(
        Effect.andThen(Ref.get(published)),
        Effect.map((signers) => jwksOf(...signers)),
      ),
    })
    const verify = makeAccessJwtVerifier({ issuer: TEST_ISSUER, audience: TEST_AUD, keys })
    return { verify, published, fetches }
  })

const sign = (signer: TestSigner, overrides: Record<string, unknown> = {}) =>
  Effect.promise(() => signer.sign(accessClaims(0, overrides)))

const failureReason = <A>(effect: Effect.Effect<A, AccessJwtError>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  )

describe("Access JWT verification", () => {
  it.effect("accepts a valid token and returns the identity", () =>
    Effect.gen(function* () {
      const { verify } = yield* makeHarness([signerA])
      const identity = yield* verify(yield* sign(signerA))
      expect(identity).toEqual({
        identity: {
          source: "cloudflare-access",
          subject: "7335d417-61da-459d-899c-0a01c76a2f94",
          email: TEST_EMAIL,
        },
        expiresAt: (3600 + 30) * 1000,
      })
    }),
  )

  it.effect("accepts a service-token JWT by common_name", () =>
    Effect.gen(function* () {
      const { verify } = yield* makeHarness([signerA])
      const identity = yield* verify(
        yield* sign(signerA, { sub: "", email: undefined, common_name: "client-id.access" }),
      )
      expect(identity.identity).toEqual({ source: "cloudflare-access", subject: "client-id.access", email: null })
    }),
  )

  it.effect("rejects an expired token", () =>
    Effect.gen(function* () {
      const { verify } = yield* makeHarness([signerA])
      const token = yield* sign(signerA)
      yield* TestClock.adjust("2 hours")
      expect(yield* failureReason(verify(token))).toBe("expired")
    }),
  )

  it.effect("rejects a token that is not valid yet", () =>
    Effect.gen(function* () {
      const { verify } = yield* makeHarness([signerA])
      const token = yield* sign(signerA, { nbf: 600, exp: 4000 })
      expect(yield* failureReason(verify(token))).toBe("not-yet-valid")
    }),
  )

  it.effect("rejects the wrong audience", () =>
    Effect.gen(function* () {
      const { verify } = yield* makeHarness([signerA])
      const token = yield* sign(signerA, { aud: ["another-application"] })
      expect(yield* failureReason(verify(token))).toBe("wrong-audience")
    }),
  )

  it.effect("rejects the wrong issuer", () =>
    Effect.gen(function* () {
      const { verify } = yield* makeHarness([signerA])
      const token = yield* sign(signerA, { iss: "https://other-team.cloudflareaccess.com" })
      expect(yield* failureReason(verify(token))).toBe("wrong-issuer")
    }),
  )

  it.effect("rejects a tampered payload", () =>
    Effect.gen(function* () {
      const { verify } = yield* makeHarness([signerA])
      const [header, , signature] = (yield* sign(signerA)).split(".")
      const forged = Buffer.from(JSON.stringify(accessClaims(0, { email: "attacker@example.com" }))).toString(
        "base64url",
      )
      expect(yield* failureReason(verify(`${header}.${forged}.${signature}`))).toBe("bad-signature")
    }),
  )

  it.effect("rejects alg none and malformed tokens", () =>
    Effect.gen(function* () {
      const { verify } = yield* makeHarness([signerA])
      const unsigned = yield* Effect.promise(() => signerA.sign(accessClaims(0), { alg: "none" }))
      expect(yield* failureReason(verify(unsigned))).toBe("unsupported-algorithm")
      expect(yield* failureReason(verify("not-a-jwt"))).toBe("malformed")
    }),
  )

  it.effect("refetches the JWKS for an unknown kid, at most once per cooldown", () =>
    Effect.gen(function* () {
      const { verify, published, fetches } = yield* makeHarness([signerA])
      yield* verify(yield* sign(signerA))
      expect(yield* Ref.get(fetches)).toBe(1)

      // Cloudflare rotates keys: the new kid is published after our fetch.
      yield* Ref.set(published, [signerA, signerB])
      const rotated = yield* sign(signerB)

      // Inside the cooldown an unknown kid does not hammer the endpoint.
      expect(yield* failureReason(verify(rotated))).toBe("unknown-key")
      expect(yield* Ref.get(fetches)).toBe(1)

      yield* TestClock.adjust("31 seconds")
      const identity = yield* verify(rotated)
      expect(identity.identity.email).toBe(TEST_EMAIL)
      expect(yield* Ref.get(fetches)).toBe(2)

      // Known kids are served from the cache.
      yield* verify(yield* sign(signerA, { exp: 3600 }))
      expect(yield* Ref.get(fetches)).toBe(2)
    }),
  )

  it.effect("reports an unreachable JWKS as jwks-unavailable", () =>
    Effect.gen(function* () {
      const keys = yield* makeAccessKeyStore({
        fetchJwks: Effect.fail(new AccessJwtError({ reason: "jwks-unavailable", message: "down" })),
      })
      const verify = makeAccessJwtVerifier({ issuer: TEST_ISSUER, audience: TEST_AUD, keys })
      expect(yield* failureReason(verify(yield* sign(signerA)))).toBe("jwks-unavailable")
    }),
  )
})

describe("BrowserAuth token extraction", () => {
  it.effect("rejects a request with neither header nor cookie", () =>
    Effect.gen(function* () {
      const { verify } = yield* makeHarness([signerA])
      const auth = BrowserAuth.fromVerifier(verify)
      expect(yield* failureReason(auth.authenticate(Headers.fromInput({})))).toBe("missing-token")
      expect(
        yield* failureReason(auth.authenticate(Headers.fromInput({ cookie: "unrelated=1" }))),
      ).toBe("missing-token")
    }),
  )

  it.effect("reads the Cf-Access-Jwt-Assertion header", () =>
    Effect.gen(function* () {
      const { verify } = yield* makeHarness([signerA])
      const auth = BrowserAuth.fromVerifier(verify)
      const identity = yield* auth.authenticate(Headers.fromInput({ "cf-access-jwt-assertion": yield* sign(signerA) }))
      expect(identity.identity.email).toBe(TEST_EMAIL)
    }),
  )

  it.effect("falls back to the CF_Authorization cookie", () =>
    Effect.gen(function* () {
      const { verify } = yield* makeHarness([signerA])
      const auth = BrowserAuth.fromVerifier(verify)
      const token = yield* sign(signerA)
      const identity = yield* auth.authenticate(Headers.fromInput({ cookie: `theme=dark; CF_Authorization=${token}` }))
      expect(identity.identity.email).toBe(TEST_EMAIL)
    }),
  )

  it.effect("prefers the header over the cookie", () =>
    Effect.gen(function* () {
      const { verify } = yield* makeHarness([signerA])
      const auth = BrowserAuth.fromVerifier(verify)
      const error = yield* Effect.flip(
        auth.authenticate(Headers.fromInput({
          "cf-access-jwt-assertion": "garbage",
          cookie: `CF_Authorization=${yield* sign(signerA)}`,
        })),
      )
      expect(error.reason).toBe("malformed")
    }),
  )

  it.effect("disabled mode returns the local development identity", () =>
    Effect.gen(function* () {
      expect(yield* BrowserAuth.disabled.authenticate(Headers.fromInput({}))).toEqual({
        identity: LOCAL_DEV_IDENTITY,
        expiresAt: null,
      })
    }),
  )
})
