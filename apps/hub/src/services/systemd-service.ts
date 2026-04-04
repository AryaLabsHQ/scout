import { Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import type { UnitFile } from "@scout/shared"
import { AgentManager } from "./agent-manager.js"
import { AgentNotConnected, RpcCallError, TimeoutError } from "../lib/errors.js"
import type { SocketError } from "effect/unstable/socket/Socket"

type SystemdError = AgentNotConnected | RpcCallError | TimeoutError | SocketError

// ── Capability check helper ───────────────────────────────────────────────────

function checkCapability(
  mgr: InstanceType<typeof AgentManager>["Type"],
  agentId: string,
): Effect.Effect<void, AgentNotConnected> {
  return mgr.getConnected(agentId).pipe(
    Effect.flatMap((connected) =>
      connected ? Effect.void : Effect.fail(new AgentNotConnected({ agentId })),
    ),
  )
}

// ── invoke helper ─────────────────────────────────────────────────────────────

function invokeAgent(
  mgr: InstanceType<typeof AgentManager>["Type"],
  agentId: string,
  method: string,
  params: Record<string, unknown>,
): Effect.Effect<unknown, SystemdError> {
  return mgr.call(
    agentId,
    {
      id: crypto.randomUUID(),
      method,
      params,
    },
    30_000,
  ).pipe(
    Effect.map((resp) => (resp as { result: unknown }).result),
  )
}

// ── Service ───────────────────────────────────────────────────────────────────

export class SystemdService extends ServiceMap.Service<SystemdService, {
  readonly start: (agentId: string, unit: string) => Effect.Effect<void, SystemdError>
  readonly stop: (agentId: string, unit: string) => Effect.Effect<void, SystemdError>
  readonly restart: (agentId: string, unit: string) => Effect.Effect<void, SystemdError>
  readonly enable: (agentId: string, unit: string) => Effect.Effect<void, SystemdError>
  readonly disable: (agentId: string, unit: string) => Effect.Effect<void, SystemdError>
  readonly reload: (agentId: string) => Effect.Effect<void, SystemdError>
  readonly getUnitFile: (agentId: string, unit: string) => Effect.Effect<UnitFile, SystemdError>
  readonly editUnitFile: (agentId: string, unit: string, content: string) => Effect.Effect<void, SystemdError>
}>()(
  "@scout/SystemdService",
  {
    make: Effect.gen(function* () {
      const mgr = yield* AgentManager

      const start = (agentId: string, unit: string) =>
        checkCapability(mgr, agentId).pipe(
          Effect.flatMap(() => invokeAgent(mgr, agentId, "systemd.start", { unit })),
          Effect.asVoid,
        )

      const stop = (agentId: string, unit: string) =>
        checkCapability(mgr, agentId).pipe(
          Effect.flatMap(() => invokeAgent(mgr, agentId, "systemd.stop", { unit })),
          Effect.asVoid,
        )

      const restart = (agentId: string, unit: string) =>
        checkCapability(mgr, agentId).pipe(
          Effect.flatMap(() => invokeAgent(mgr, agentId, "systemd.restart", { unit })),
          Effect.asVoid,
        )

      const enable = (agentId: string, unit: string) =>
        checkCapability(mgr, agentId).pipe(
          Effect.flatMap(() => invokeAgent(mgr, agentId, "systemd.enable", { unit })),
          Effect.asVoid,
        )

      const disable = (agentId: string, unit: string) =>
        checkCapability(mgr, agentId).pipe(
          Effect.flatMap(() => invokeAgent(mgr, agentId, "systemd.disable", { unit })),
          Effect.asVoid,
        )

      const reload = (agentId: string) =>
        checkCapability(mgr, agentId).pipe(
          Effect.flatMap(() => invokeAgent(mgr, agentId, "systemd.reload", {})),
          Effect.asVoid,
        )

      const getUnitFile = (agentId: string, unit: string): Effect.Effect<UnitFile, SystemdError> =>
        checkCapability(mgr, agentId).pipe(
          Effect.flatMap(() => invokeAgent(mgr, agentId, "systemd.unit-file", { unit })),
          Effect.map((result) => result as UnitFile),
        )

      const editUnitFile = (agentId: string, unit: string, content: string) =>
        checkCapability(mgr, agentId).pipe(
          Effect.flatMap(() => invokeAgent(mgr, agentId, "systemd.unit-file-edit", { unit, content })),
          Effect.asVoid,
        )

      return { start, stop, restart, enable, disable, reload, getUnitFile, editUnitFile }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
