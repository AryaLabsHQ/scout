import { AtomRpc } from "effect/reactivity"
import { ClientHubRpcs } from "@scout/shared"
import { HubProtocolLayer } from "./protocol.js"

/**
 * HubClient — AtomRpc service for the browser → hub RPC connection.
 *
 * Auth: The hub's `/ws/rpc` endpoint accepts a `authorization: Bearer <token>`
 * header per request. For now we skip per-request token injection; the hub
 * relies on Tailscale network security for personal-use deployments. Phase I
 * will add header middleware if token-per-request is needed.
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
