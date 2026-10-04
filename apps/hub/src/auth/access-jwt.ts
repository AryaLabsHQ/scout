/**
 * Cloudflare Access JWT verification.
 *
 * Cloudflare Access signs an RS256 JWT for every request it lets through and
 * publishes the signing keys at `https://<team-domain>/cdn-cgi/access/certs`.
 * See https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 *
 * Verification:
 *   1. header.alg is RS256 and header.kid names a key in the team JWKS
 *      (fetched lazily, cached, refetched on an unknown kid at most once per
 *      `unknownKidCooldown`, and refreshed after `maxAge`)
 *   2. the signature verifies with that key (WebCrypto RSASSA-PKCS1-v1_5)
 *   3. `iss` equals the team issuer, `aud` contains the application AUD tag,
 *      `exp` is in the future and `nbf` (when present) is in the past, both
 *      with `clockSkew` leeway
 */

import { Clock, Data, Duration, Effect, Ref, Semaphore } from "effect"
import type { Identity } from "@scout/shared"

// ── Errors ───────────────────────────────────────────────────────────────────

export type AccessJwtFailure =
  | "missing-token"
  | "malformed"
  | "unsupported-algorithm"
  | "unknown-key"
  | "bad-signature"
  | "expired"
  | "not-yet-valid"
  | "wrong-issuer"
  | "wrong-audience"
  | "missing-subject"
  | "jwks-unavailable"

export class AccessJwtError extends Data.TaggedError("AccessJwtError")<{
  readonly reason: AccessJwtFailure
  readonly message: string
}> {}

const reject = (reason: AccessJwtFailure, message: string) =>
  Effect.fail(new AccessJwtError({ reason, message }))

// ── Signing keys ─────────────────────────────────────────────────────────────

/** Fetches the raw JWKS document (`{ keys: [...] }`). */
export type FetchJwks = Effect.Effect<unknown, AccessJwtError>

export interface AccessKeyStore {
  /** Resolve a signing key by kid, refetching the JWKS when the kid is unknown. */
  readonly get: (kid: string) => Effect.Effect<CryptoKey, AccessJwtError>
}

export interface AccessKeyStoreOptions {
  readonly fetchJwks: FetchJwks
  /** Refetch the JWKS after this long even when every kid resolves. Default 1 hour. */
  readonly maxAge?: Duration.Input | undefined
  /** Minimum gap between refetches triggered by unknown kids. Default 30 seconds. */
  readonly unknownKidCooldown?: Duration.Input | undefined
}

interface KeyCache {
  readonly keys: ReadonlyMap<string, CryptoKey>
  readonly fetchedAt: number
}

interface Jwk {
  readonly kty?: unknown
  readonly kid?: unknown
  readonly alg?: unknown
  readonly use?: unknown
  readonly n?: unknown
  readonly e?: unknown
}

const importJwks = (document: unknown): Effect.Effect<ReadonlyMap<string, CryptoKey>, AccessJwtError> =>
  Effect.gen(function* () {
    const keys = (document as { readonly keys?: unknown } | null)?.keys
    if (!Array.isArray(keys)) {
      return yield* reject("jwks-unavailable", "JWKS document has no keys array")
    }
    const imported = new Map<string, CryptoKey>()
    for (const jwk of keys as ReadonlyArray<Jwk>) {
      if (jwk.kty !== "RSA" || typeof jwk.kid !== "string") continue
      if (typeof jwk.n !== "string" || typeof jwk.e !== "string") continue
      const { kid, n, e } = jwk
      if (jwk.alg !== undefined && jwk.alg !== "RS256") continue
      if (jwk.use !== undefined && jwk.use !== "sig") continue
      const key = yield* Effect.tryPromise({
        try: () =>
          crypto.subtle.importKey(
            "jwk",
            { kty: "RSA", n, e, alg: "RS256", ext: true },
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            false,
            ["verify"],
          ),
        catch: () =>
          new AccessJwtError({
            reason: "jwks-unavailable",
            message: `JWKS key ${kid} is not a valid RSA key`,
          }),
      })
      imported.set(kid, key)
    }
    return imported
  })

export const makeAccessKeyStore = (
  options: AccessKeyStoreOptions,
): Effect.Effect<AccessKeyStore> =>
  Effect.gen(function* () {
    const maxAge = Duration.toMillis(Duration.fromInputUnsafe(options.maxAge ?? "1 hour"))
    const cooldown = Duration.toMillis(Duration.fromInputUnsafe(options.unknownKidCooldown ?? "30 seconds"))
    const cache = yield* Ref.make<KeyCache | null>(null)
    const refreshLock = yield* Semaphore.make(1)

    // Serialized so a burst of requests with a new kid triggers one fetch.
    // `isStale` is re-evaluated under the lock against the latest cache.
    const refreshIf = (isStale: (current: KeyCache | null, now: number) => boolean) =>
      refreshLock.withPermit(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const current = yield* Ref.get(cache)
          if (!isStale(current, now)) return current
          const document = yield* options.fetchJwks
          const keys = yield* importJwks(document)
          const next: KeyCache = { keys, fetchedAt: now }
          yield* Ref.set(cache, next)
          return next
        }),
      )

    const get = (kid: string): Effect.Effect<CryptoKey, AccessJwtError> =>
      Effect.gen(function* () {
        const fresh = yield* refreshIf((current, now) => current === null || now - current.fetchedAt >= maxAge)
        const known = fresh?.keys.get(kid)
        if (known !== undefined) return known

        const refreshed = yield* refreshIf(
          (current, now) =>
            current === null || (!current.keys.has(kid) && now - current.fetchedAt >= cooldown),
        )
        const key = refreshed?.keys.get(kid)
        if (key === undefined) {
          return yield* reject("unknown-key", `No Access signing key with kid "${kid}"`)
        }
        return key
      })

    return { get }
  })

// ── Token verification ───────────────────────────────────────────────────────

export interface AccessJwtVerifierOptions {
  readonly issuer: string
  readonly audience: string
  readonly keys: AccessKeyStore
  /** Leeway applied to `exp` and `nbf`. Default 30 seconds. */
  readonly clockSkew?: Duration.Input | undefined
}

export interface AccessJwtClaims {
  readonly iss?: unknown
  readonly aud?: unknown
  readonly exp?: unknown
  readonly nbf?: unknown
  readonly sub?: unknown
  readonly email?: unknown
  readonly common_name?: unknown
}

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

const decodeBase64Url = (segment: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(segment)) return null
  try {
    return Uint8Array.from(Buffer.from(segment, "base64url"))
  } catch {
    return null
  }
}

const decodeJsonSegment = (segment: string): Record<string, unknown> | null => {
  const bytes = decodeBase64Url(segment)
  if (bytes === null) return null
  try {
    const value: unknown = JSON.parse(textDecoder.decode(bytes))
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

export type AccessJwtVerifier = (token: string) => Effect.Effect<Identity, AccessJwtError>

export const makeAccessJwtVerifier = (options: AccessJwtVerifierOptions): AccessJwtVerifier => {
  const skewSeconds = Duration.toSeconds(Duration.fromInputUnsafe(options.clockSkew ?? "30 seconds"))

  return (token) =>
    Effect.gen(function* () {
      const parts = token.split(".")
      if (parts.length !== 3) return yield* reject("malformed", "Access JWT must have three segments")
      const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string]

      const header = decodeJsonSegment(headerSegment)
      const claims = decodeJsonSegment(payloadSegment) as AccessJwtClaims | null
      const signature = decodeBase64Url(signatureSegment)
      if (header === null || claims === null || signature === null) {
        return yield* reject("malformed", "Access JWT is not valid base64url JSON")
      }
      if (header["alg"] !== "RS256") {
        return yield* reject("unsupported-algorithm", `Access JWT alg must be RS256 (got ${String(header["alg"])})`)
      }
      const kid = nonEmptyString(header["kid"])
      if (kid === null) return yield* reject("malformed", "Access JWT header has no kid")

      const key = yield* options.keys.get(kid)
      const valid = yield* Effect.tryPromise({
        try: () =>
          crypto.subtle.verify(
            "RSASSA-PKCS1-v1_5",
            key,
            signature,
            textEncoder.encode(`${headerSegment}.${payloadSegment}`),
          ),
        catch: () => new AccessJwtError({ reason: "bad-signature", message: "Access JWT signature check failed" }),
      })
      if (!valid) return yield* reject("bad-signature", "Access JWT signature is invalid")

      if (claims.iss !== options.issuer) {
        return yield* reject("wrong-issuer", `Access JWT issuer ${String(claims.iss)} is not ${options.issuer}`)
      }
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
      if (!audiences.includes(options.audience)) {
        return yield* reject("wrong-audience", "Access JWT audience does not include this application")
      }

      const nowSeconds = (yield* Clock.currentTimeMillis) / 1000
      if (typeof claims.exp !== "number" || claims.exp + skewSeconds <= nowSeconds) {
        return yield* reject("expired", "Access JWT is expired")
      }
      if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf - skewSeconds > nowSeconds)) {
        return yield* reject("not-yet-valid", "Access JWT is not valid yet")
      }

      // User logins carry `sub` + `email`; service tokens carry an empty
      // `sub` and the client id in `common_name`.
      const subject = nonEmptyString(claims.sub) ?? nonEmptyString(claims.common_name)
      if (subject === null) return yield* reject("missing-subject", "Access JWT has no subject")

      return {
        source: "cloudflare-access",
        subject,
        email: nonEmptyString(claims.email),
      } satisfies Identity
    })
}
