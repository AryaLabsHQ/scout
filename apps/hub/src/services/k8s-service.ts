import { Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import type { RpcResponse } from "@scout/shared"
import { AgentManager } from "./agent-manager.js"
import { AgentNotConnected, RpcCallError, TimeoutError } from "../lib/errors.js"
import type { SocketError } from "effect/unstable/socket/Socket"

type K8sError = AgentNotConnected | RpcCallError | TimeoutError | SocketError

// ── invoke helper ─────────────────────────────────────────────────────────────

function invokeAgent(
  mgr: InstanceType<typeof AgentManager>["Type"],
  agentId: string,
  method: string,
  params: Record<string, unknown>,
): Effect.Effect<unknown, K8sError> {
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

export class K8sService extends ServiceMap.Service<K8sService, {
  readonly scale: (agentId: string, deployment: string, namespace: string, replicas: number) => Effect.Effect<void, K8sError>
  readonly restartPod: (agentId: string, podName: string, namespace: string) => Effect.Effect<void, K8sError>
  readonly describe: (agentId: string, resource: string, name: string, namespace: string) => Effect.Effect<string, K8sError>
}>()(
  "@scout/K8sService",
  {
    make: Effect.gen(function* () {
      const mgr = yield* AgentManager

      const scale = (agentId: string, deployment: string, namespace: string, replicas: number) =>
        invokeAgent(mgr, agentId, "k8s.scale", { deployment, namespace, replicas }).pipe(Effect.asVoid)

      const restartPod = (agentId: string, podName: string, namespace: string) =>
        invokeAgent(mgr, agentId, "k8s.restart-pod", { podName, namespace }).pipe(Effect.asVoid)

      const describe = (agentId: string, resource: string, name: string, namespace: string): Effect.Effect<string, K8sError> =>
        invokeAgent(mgr, agentId, "k8s.describe", { resource, name, namespace }).pipe(
          Effect.map((result) => (typeof result === "string" ? result : JSON.stringify(result ?? {}))),
        )

      return { scale, restartPod, describe }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
