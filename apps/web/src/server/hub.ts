import { getCookie, getRequestHeader } from "@tanstack/react-start/server"

/**
 * Hub base URL for server-side (SSR / server function) calls. In production
 * this is the hub's loopback listener, e.g. `http://127.0.0.1:3001`; browsers
 * never see it — they reach the hub same-origin through the reverse proxy.
 */
export const HUB_URL =
  (typeof process !== "undefined" && process.env["SCOUT_HUB_URL"]) ||
  "http://127.0.0.1:3001"

const ACCESS_JWT_HEADER = "cf-access-jwt-assertion"
const ACCESS_JWT_COOKIE = "CF_Authorization"

/**
 * The hub authenticates every `/api/*` call with the caller's Cloudflare
 * Access JWT. Forward the incoming request's assertion header, or only the
 * `CF_Authorization` cookie when the header is absent. With the hub's
 * `SCOUT_AUTH=disabled` dev mode neither is needed.
 */
const forwardedAuthHeaders = (): Record<string, string> => {
  const assertion = getRequestHeader(ACCESS_JWT_HEADER)
  if (assertion) return { [ACCESS_JWT_HEADER]: assertion }
  const cookie = getCookie(ACCESS_JWT_COOKIE)
  if (cookie) return { cookie: `${ACCESS_JWT_COOKIE}=${cookie}` }
  return {}
}

/**
 * Fetch a hub path from a server function, forwarding the caller's Access
 * credentials. Only call it inside a server function or loader running on the
 * server, where the incoming request is available.
 */
export async function hubFetch(
  path: string,
  searchParams?: Record<string, string | undefined>,
): Promise<Response> {
  const url = new URL(path, HUB_URL)
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  return fetch(url, { headers: forwardedAuthHeaders() })
}
