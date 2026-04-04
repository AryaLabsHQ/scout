import { Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"

// Not implemented — M7
// Evaluates AlertRules against incoming metrics, fires/resolves alerts, and
// sends notifications.

export class AlertEngine extends ServiceMap.Service<AlertEngine, {
  readonly _tag: "@scout/AlertEngine"
}>()(
  "@scout/AlertEngine",
  {
    make: Effect.gen(function* () {
      // TODO: implement in M7
      return yield* Effect.die(new Error("Not implemented — M7"))
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
