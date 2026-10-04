import * as Context from "effect/Context"
import * as RpcMiddleware from "effect/rpc/RpcMiddleware"
import { Unauthorized, type Identity } from "../schemas/auth.js"

/**
 * The verified identity of the browser request an RPC handler is serving.
 * Provided by `ClientAuthMiddleware` on the hub.
 */
export class CurrentIdentity extends Context.Service<CurrentIdentity, Identity>()("@scout/CurrentIdentity") {}

/**
 * Server-side authentication for `ClientHubRpcs`.
 *
 * The hub implements it by verifying the Cloudflare Access JWT carried by the
 * websocket upgrade request; the browser needs no client-side counterpart
 * because Cloudflare Access attaches the credential to every request.
 */
export class ClientAuthMiddleware extends RpcMiddleware.Service<
  ClientAuthMiddleware,
  { provides: CurrentIdentity }
>()("@scout/ClientAuthMiddleware", {
  error: Unauthorized,
}) {}
