import { AtomRpc } from "effect/reactivity"
import { ClientHubRpcs } from "@scout/shared"
import { HubProtocolLayer } from "./protocol.js"

/**
 * HubClient — AtomRpc service for the browser → hub RPC connection.
 *
 * Auth: the hub authenticates `/ws/rpc` with the Cloudflare Access JWT that
 * Access attaches to the same-origin websocket upgrade (header or
 * `CF_Authorization` cookie), so the client sends no credentials itself. RPCs
 * can fail with `Unauthorized` once that JWT expires.
 *
 * Usage:
 *   // Read-only query:
 *   const atom = HubClient.query("systems.list", undefined)
 *   const result = useAtomValue(atom) // AsyncResult<System[], ...>
 *
 *   // Mutation:
 *   const [result, run] = useAtom(HubClient.mutation("alerts.ack"))
 *   run({ payload: { alertId }, reactivityKeys: ["alerts"] })
 *
 *   // Stream (returns Writable<PullResult<A, E>, void>):
 *   const [result, pull] = useAtom(HubClient.query("plugins.logs", params))
 */
export class HubClient extends AtomRpc.Service<HubClient>()("HubClient", {
  group: ClientHubRpcs,
  protocol: HubProtocolLayer,
}) {}
