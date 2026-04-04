import { Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"

// Not implemented — M5
// Proxies Kubernetes management RPC calls to agents (scale deployments,
// restart pods, stream pod logs).

export class K8sService extends ServiceMap.Service<K8sService, {
  readonly _tag: "@scout/K8sService"
}>()(
  "@scout/K8sService",
  {
    make: Effect.gen(function* () {
      // TODO: implement in M5
      return yield* Effect.die(new Error("Not implemented — M5"))
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
