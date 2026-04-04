import { Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"

// Not implemented — M4
// Streams and queries structured logs from agents (journal, container logs).

export class LogService extends ServiceMap.Service<LogService, {
  readonly _tag: "@scout/LogService"
}>()(
  "@scout/LogService",
  {
    make: Effect.gen(function* () {
      // TODO: implement in M4
      return yield* Effect.die(new Error("Not implemented — M4"))
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
