import { Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"

// Not implemented — M5
// Proxies systemd management RPC calls to agents (start/stop/restart units,
// stream journal logs).

export class SystemdService extends ServiceMap.Service<SystemdService, {
  readonly _tag: "@scout/SystemdService"
}>()(
  "@scout/SystemdService",
  {
    make: Effect.gen(function* () {
      // TODO: implement in M5
      return yield* Effect.die(new Error("Not implemented — M5"))
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
