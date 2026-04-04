export const HUB_URL =
  (typeof process !== "undefined" && process.env["SCOUT_HUB_URL"]) ||
  "http://localhost:3001"

export async function hubFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith("http") ? path : `${HUB_URL}${path}`
  return fetch(url, init)
}
