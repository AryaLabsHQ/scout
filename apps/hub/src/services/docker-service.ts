import { Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"

// Not implemented — M5
// Proxies Docker management RPC calls to agents (start/stop/restart containers,
// stream logs, pull images).

export class DockerService extends ServiceMap.Service<DockerService, {
  readonly _tag: "@scout/DockerService"
}>()(
  "@scout/DockerService",
  {
    make: Effect.gen(function* () {
      // TODO: implement in M5
      return yield* Effect.die(new Error("Not implemented — M5"))
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
