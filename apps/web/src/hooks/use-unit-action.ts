import { useCallback } from "react"
import { useAtomSet } from "@effect/atom-react"
import { toast } from "sonner"
import { SYSTEMD_ACTION_IDS, SYSTEMD_PLUGIN_ID, SYSTEMD_SERVICE_KINDS } from "@scout/plugin-systemd/contracts"
import { HubClient } from "@/rpc/client"
import { useConfirm } from "@/providers/confirm-provider"
import { UNIT_ACTIONS, systemctlFor, type SystemdScope, type UnitActionKind } from "@/lib/systemd"

const PERMISSION_NOTE =
  "The agent runs systemctl with --no-ask-password, so a unit change it is not permitted to make fails right away instead of waiting for a password."

const USER_SCOPE_NOTE =
  "This is a user unit: the agent changes it through its own user manager (systemctl --user), which needs no polkit grant."

const errorMessage = (error: unknown): string => {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message
  }
  return String(error)
}

/**
 * Run a systemd unit action (or `daemon-reload`) on a machine, always behind
 * the confirm dialog, and report the outcome as a toast.
 */
export function useUnitAction(systemId: string, hostname: string) {
  const confirm = useConfirm()
  const runAction = useAtomSet(HubClient.mutation("plugins.runAction"), { mode: "promise" })

  const run = useCallback(
    async (kind: UnitActionKind, unitId: string, scope: SystemdScope = "system") => {
      const action = UNIT_ACTIONS[kind]
      const confirmed = await confirm({
        title: `${action.verb} ${scope === "user" ? "user unit " : ""}${unitId} on ${hostname}?`,
        description: `${action.effect} Scout records this action in the hub audit log under your identity.`,
        command: `${systemctlFor(scope)} ${kind} ${unitId}`,
        confirmLabel: action.verb,
        destructive: action.destructive,
        note: scope === "user" ? USER_SCOPE_NOTE : PERMISSION_NOTE,
      })
      if (!confirmed) return
      try {
        const result = await runAction({
          payload: {
            agentId: systemId,
            pluginId: SYSTEMD_PLUGIN_ID,
            actionId: action.actionId,
            entity: { pluginId: SYSTEMD_PLUGIN_ID, kind: SYSTEMD_SERVICE_KINDS[scope], id: unitId },
          },
        })
        if (result.success) toast.success(result.summary ?? `${action.verb} ${unitId}: done`)
        else toast.error(result.summary ?? `${action.verb} ${unitId} failed`)
      } catch (error) {
        toast.error(`${action.verb} ${unitId} failed: ${errorMessage(error)}`)
      }
    },
    [confirm, hostname, runAction, systemId],
  )

  const daemonReload = useCallback(async () => {
    const confirmed = await confirm({
      title: `Reload systemd on ${hostname}?`,
      description: "systemd re-reads every unit file. Running units keep running.",
      command: "systemctl daemon-reload",
      confirmLabel: "Reload",
      note: PERMISSION_NOTE,
    })
    if (!confirmed) return
    try {
      const result = await runAction({
        payload: {
          agentId: systemId,
          pluginId: SYSTEMD_PLUGIN_ID,
          actionId: SYSTEMD_ACTION_IDS.daemonReload,
        },
      })
      if (result.success) toast.success(result.summary ?? "systemd reloaded")
      else toast.error(result.summary ?? "daemon-reload failed")
    } catch (error) {
      toast.error(`daemon-reload failed: ${errorMessage(error)}`)
    }
  }, [confirm, hostname, runAction, systemId])

  return { run, daemonReload }
}
