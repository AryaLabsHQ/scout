import { Schema } from "effect"

// ─── Browser identity ─────────────────────────────────────────────────────

/**
 * Who a browser-facing request acts as.
 *
 * `cloudflare-access` identities come from a verified Cloudflare Access JWT;
 * `subject` is the JWT `sub` (or the service token's `common_name`) and
 * `email` is present for user logins. `auth-disabled` is the loopback-only
 * local development identity.
 */
export const IdentitySchema = Schema.Struct({
  source: Schema.Literals(["cloudflare-access", "auth-disabled"]),
  subject: Schema.String,
  email: Schema.NullOr(Schema.String),
})
export type Identity = typeof IdentitySchema.Type

// ─── Errors ───────────────────────────────────────────────────────────────

export class Unauthorized extends Schema.Error<Unauthorized>("Unauthorized")({
  _tag: Schema.tag("Unauthorized"),
  message: Schema.String,
}) {}
