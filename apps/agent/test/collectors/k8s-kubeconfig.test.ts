import { describe, expect, it } from "vitest"
import { parseKubeconfig } from "../../src/collectors/k8s.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64")

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BEARER_TOKEN_KUBECONFIG = `
apiVersion: v1
kind: Config
current-context: my-context
contexts:
  - name: my-context
    context:
      cluster: my-cluster
      user: my-user
clusters:
  - name: my-cluster
    cluster:
      server: https://api.example.com:6443
users:
  - name: my-user
    user:
      token: abc123
`

const FAKE_CA_PEM = "-----BEGIN CERTIFICATE-----\nFAKECA\n-----END CERTIFICATE-----"
const FAKE_CERT_PEM = "-----BEGIN CERTIFICATE-----\nFAKECLIENT\n-----END CERTIFICATE-----"
const FAKE_KEY_PEM = "-----BEGIN EC PRIVATE KEY-----\nFAKEKEY\n-----END EC PRIVATE KEY-----"

const K3S_KUBECONFIG = `
apiVersion: v1
kind: Config
current-context: default
contexts:
  - name: default
    context:
      cluster: default
      user: default
clusters:
  - name: default
    cluster:
      server: https://127.0.0.1:6443
      certificate-authority-data: ${b64(FAKE_CA_PEM)}
users:
  - name: default
    user:
      client-certificate-data: ${b64(FAKE_CERT_PEM)}
      client-key-data: ${b64(FAKE_KEY_PEM)}
`

const MULTI_CONTEXT_KUBECONFIG = `
apiVersion: v1
kind: Config
current-context: prod
contexts:
  - name: dev
    context:
      cluster: dev-cluster
      user: dev-user
  - name: prod
    context:
      cluster: prod-cluster
      user: prod-user
clusters:
  - name: dev-cluster
    cluster:
      server: https://dev.example.com:6443
  - name: prod-cluster
    cluster:
      server: https://prod.example.com:6443
users:
  - name: dev-user
    user:
      token: dev-token
  - name: prod-user
    user:
      token: prod-token
`

const INSECURE_KUBECONFIG = `
apiVersion: v1
kind: Config
current-context: local
contexts:
  - name: local
    context:
      cluster: local
      user: local
clusters:
  - name: local
    cluster:
      server: https://localhost:6443
      insecure-skip-tls-verify: true
users:
  - name: local
    user:
      token: local-token
`

const NO_CURRENT_CONTEXT_KUBECONFIG = `
apiVersion: v1
kind: Config
contexts:
  - name: my-context
    context:
      cluster: my-cluster
      user: my-user
clusters:
  - name: my-cluster
    cluster:
      server: https://api.example.com:6443
users:
  - name: my-user
    user:
      token: abc123
`

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseKubeconfig", () => {
  it("parses bearer-token kubeconfig (backwards compatibility)", () => {
    const cfg = parseKubeconfig(BEARER_TOKEN_KUBECONFIG)
    expect(cfg).not.toBeNull()
    expect(cfg?.baseUrl).toBe("https://api.example.com:6443")
    expect(cfg?.headers["Authorization"]).toBe("Bearer abc123")
    expect(cfg?.tls).toBeUndefined()
  })

  it("parses k3s-style kubeconfig with client cert/key and CA", () => {
    const cfg = parseKubeconfig(K3S_KUBECONFIG)
    expect(cfg).not.toBeNull()
    expect(cfg?.baseUrl).toBe("https://127.0.0.1:6443")
    // No bearer token — k3s uses mTLS
    expect(cfg?.headers["Authorization"]).toBeUndefined()
    // TLS material decoded from base64 to PEM
    expect(cfg?.tls?.ca).toBe(FAKE_CA_PEM)
    expect(cfg?.tls?.cert).toBe(FAKE_CERT_PEM)
    expect(cfg?.tls?.key).toBe(FAKE_KEY_PEM)
    expect(cfg?.tls?.rejectUnauthorized).toBeUndefined()
  })

  it("picks the correct context when multiple are defined", () => {
    const cfg = parseKubeconfig(MULTI_CONTEXT_KUBECONFIG)
    expect(cfg).not.toBeNull()
    expect(cfg?.baseUrl).toBe("https://prod.example.com:6443")
    expect(cfg?.headers["Authorization"]).toBe("Bearer prod-token")
  })

  it("honors insecure-skip-tls-verify", () => {
    const cfg = parseKubeconfig(INSECURE_KUBECONFIG)
    expect(cfg).not.toBeNull()
    expect(cfg?.tls?.rejectUnauthorized).toBe(false)
    expect(cfg?.headers["Authorization"]).toBe("Bearer local-token")
  })

  it("returns null for malformed YAML", () => {
    expect(parseKubeconfig(":::not yaml:::")).toBeNull()
  })

  it("returns null when current-context is missing", () => {
    expect(parseKubeconfig(NO_CURRENT_CONTEXT_KUBECONFIG)).toBeNull()
  })

  it("returns null for empty input", () => {
    expect(parseKubeconfig("")).toBeNull()
  })
})
