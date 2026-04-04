import { Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"

// Receives RPC commands from hub (systemd, docker, k8s management actions).
// Stub for now — implemented in M5.
export class CommandHandler extends ServiceMap.Service<CommandHandler, {
  /**
   * Long-running fiber: listens for inbound RPC requests from the hub and
   * dispatches them to the appropriate handler. Never resolves under normal operation.
   */
  readonly run: Effect.Effect<never>
}>()(
  "@scout/CommandHandler",
  {
    make: Effect.gen(function* () {
      // Stub — implemented in M5
      return yield* Effect.die(new Error("CommandHandler not yet implemented"))
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
