/**
 * Test-only Cloudflare Access stand-in: a locally generated RSA key pair that
 * signs Access-shaped JWTs, and the matching JWKS document.
 */

export const TEST_TEAM_DOMAIN = "scout-test.cloudflareaccess.com"
export const TEST_ISSUER = `https://${TEST_TEAM_DOMAIN}`
export const TEST_AUD = "test-aud-0123456789abcdef"
export const TEST_EMAIL = "user@example.com"

export interface TestSigner {
  readonly kid: string
  readonly jwk: Record<string, string>
  readonly sign: (claims: Record<string, unknown>, header?: Record<string, unknown>) => Promise<string>
}

const base64url = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes).toString("base64url")

export const makeTestSigner = async (kid: string): Promise<TestSigner> => {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )
  const exported = await crypto.subtle.exportKey("jwk", publicKey)
  const jwk = { kty: "RSA", kid, alg: "RS256", use: "sig", n: exported.n!, e: exported.e! }

  const sign = async (claims: Record<string, unknown>, header: Record<string, unknown> = {}) => {
    const signingInput = `${base64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT", ...header }))}.${base64url(JSON.stringify(claims))}`
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(signingInput),
    )
    return `${signingInput}.${base64url(new Uint8Array(signature))}`
  }

  return { kid, jwk, sign }
}

export const jwksOf = (...signers: ReadonlyArray<TestSigner>) => ({
  keys: signers.map((signer) => signer.jwk),
})

/** Claims as Cloudflare Access issues them for a user login, valid for an hour from `nowSeconds`. */
export const accessClaims = (nowSeconds: number, overrides: Record<string, unknown> = {}) => ({
  iss: TEST_ISSUER,
  aud: [TEST_AUD],
  sub: "7335d417-61da-459d-899c-0a01c76a2f94",
  email: TEST_EMAIL,
  type: "app",
  iat: nowSeconds,
  nbf: nowSeconds,
  exp: nowSeconds + 3600,
  ...overrides,
})
