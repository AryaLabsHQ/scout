import { Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"

// Not implemented — M6
// Manages interactive terminal sessions (shell or pod exec) over WebSocket.

export class TerminalService extends ServiceMap.Service<TerminalService, {
  readonly _tag: "@scout/TerminalService"
}>()(
  "@scout/TerminalService",
  {
    make: Effect.gen(function* () {
      // TODO: implement in M6
      return yield* Effect.die(new Error("Not implemented — M6"))
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
