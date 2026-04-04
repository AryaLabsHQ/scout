import { Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import type { RpcResponse } from "@scout/shared"
import { AgentManager } from "./agent-manager.js"
import { AgentNotConnected, RpcCallError, TimeoutError } from "../lib/errors.js"
import type { SocketError } from "effect/unstable/socket/Socket"

type DockerError = AgentNotConnected | RpcCallError | TimeoutError | SocketError

// ── invoke helper ─────────────────────────────────────────────────────────────

function invokeAgent(
  mgr: InstanceType<typeof AgentManager>["Type"],
  agentId: string,
  method: string,
  params: Record<string, unknown>,
): Effect.Effect<unknown, DockerError> {
  return mgr.getConnected(agentId).pipe(
    Effect.flatMap((connected) =>
      connected
        ? mgr.call(agentId, { id: crypto.randomUUID(), method, params }, 30_000).pipe(
            Effect.map((resp) => (resp as RpcResponse).result),
          )
        : Effect.fail(new AgentNotConnected({ agentId })),
    ),
  )
}

// ── Service ───────────────────────────────────────────────────────────────────

export class DockerService extends ServiceMap.Service<DockerService, {
  readonly start: (agentId: string, containerId: string) => Effect.Effect<void, DockerError>
  readonly stop: (agentId: string, containerId: string) => Effect.Effect<void, DockerError>
  readonly restart: (agentId: string, containerId: string) => Effect.Effect<void, DockerError>
  readonly remove: (agentId: string, containerId: string) => Effect.Effect<void, DockerError>
  readonly inspect: (agentId: string, containerId: string) => Effect.Effect<unknown, DockerError>
  readonly logs: (agentId: string, containerId: string, tail: number) => Effect.Effect<string, DockerError>
}>()(
  "@scout/DockerService",
  {
    make: Effect.gen(function* () {
      const mgr = yield* AgentManager

      const start = (agentId: string, containerId: string) =>
        invokeAgent(mgr, agentId, "docker.start", { containerId }).pipe(Effect.asVoid)

      const stop = (agentId: string, containerId: string) =>
        invokeAgent(mgr, agentId, "docker.stop", { containerId }).pipe(Effect.asVoid)

      const restart = (agentId: string, containerId: string) =>
        invokeAgent(mgr, agentId, "docker.restart", { containerId }).pipe(Effect.asVoid)

      const remove = (agentId: string, containerId: string) =>
        invokeAgent(mgr, agentId, "docker.remove", { containerId }).pipe(Effect.asVoid)

      const inspect = (agentId: string, containerId: string): Effect.Effect<unknown, DockerError> =>
        invokeAgent(mgr, agentId, "docker.inspect", { containerId })

      const logs = (agentId: string, containerId: string, tail: number): Effect.Effect<string, DockerError> =>
        invokeAgent(mgr, agentId, "docker.logs", { containerId, tail }).pipe(
          Effect.map((result) => (typeof result === "string" ? result : String(result ?? ""))),
        )

      return { start, stop, restart, remove, inspect, logs }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
