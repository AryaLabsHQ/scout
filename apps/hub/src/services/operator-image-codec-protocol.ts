import { Schema } from "effect"
import { OperatorImageMetadataSchema } from "@scout/shared"

export const OPERATOR_IMAGE_DECODE_TIMEOUT_MS = 15_000

export const OperatorImageDecodeRequest = Schema.Struct({
  bytes: Schema.Uint8Array,
  metadata: OperatorImageMetadataSchema,
})

export const OperatorImageDecodeResponse = Schema.Union([
  Schema.Struct({ status: Schema.Literal("started") }),
  Schema.Struct({ status: Schema.Literal("done"), valid: Schema.Boolean }),
])
