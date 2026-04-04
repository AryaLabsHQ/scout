import { Schema } from "effect"

export const RpcRequestSchema = Schema.Struct({
  id: Schema.String,
  method: Schema.String,
  params: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
})

export const RpcErrorSchema = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
})

export const RpcResponseSchema = Schema.Struct({
  id: Schema.String,
  ok: Schema.Boolean,
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(RpcErrorSchema),
})

export const RpcEventSchema = Schema.Struct({
  event: Schema.String,
  streamId: Schema.optionalKey(Schema.String),
  data: Schema.optionalKey(Schema.Unknown),
  dataBase64: Schema.optionalKey(Schema.String),
})

export const ScoutMessageSchema = Schema.Union([
  RpcRequestSchema,
  RpcResponseSchema,
  RpcEventSchema,
])

export const decodeScoutMessage = Schema.decodeUnknownEffect(ScoutMessageSchema)
