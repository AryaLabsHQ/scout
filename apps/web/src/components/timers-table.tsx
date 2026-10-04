import { useNavigate } from "@tanstack/react-router"
import type { EntitySnapshot } from "@scout/plugin-sdk"
import { StatusDot } from "@/components/status-dot"
import { TimeAgo, TimeUntil } from "@/components/time-ago"
import { shortUnitName, timerFailed, timerRunning, timerState, timerTone } from "@/lib/systemd"
import { cn } from "@/lib/utils"

/** "last run 19h ago · success · exit 0", or why there is no last run. */
function LastRun({ timer }: { timer: EntitySnapshot }) {
  const state = timerState(timer)
  if (timerRunning(state)) return <span>running now</span>
  if (state.lastExitAt === null) {
    return state.lastTriggerAt === null ? <span>never run</span> : <TimeAgo at={state.lastTriggerAt} prefix="last run " />
  }
  return (
    <span className={cn(timerFailed(state) && "text-err")}>
      <TimeAgo at={state.lastExitAt} prefix="last run " />
      {state.lastResult ? ` · ${state.lastResult}` : ""}
      {state.lastExitStatus !== null ? ` · exit ${state.lastExitStatus}` : ""}
    </span>
  )
}

/**
 * systemd timers as compact rows: status dot, timer name, the last run of the
 * unit it activates, and the next run. Rows open the activated service.
 */
export function TimersTable({ systemId, timers }: { systemId: string; timers: ReadonlyArray<EntitySnapshot> }) {
  const navigate = useNavigate()

  return (
    <table className="w-full table-fixed text-left text-[13px]">
      <tbody>
        {timers.map((timer) => {
          const state = timerState(timer)
          const opensService = state.activates.endsWith(".service")
          return (
            <tr
              key={`${timer.ref.kind}/${timer.ref.id}`}
              onClick={
                opensService
                  ? () =>
                      void navigate({
                        to: "/systems/$systemId/services/$unitId",
                        params: { systemId, unitId: state.activates },
                        search: state.scope === "user" ? { scope: state.scope } : {},
                      })
                  : undefined
              }
              className={cn("border-t border-border first:border-t-0", opensService && "cursor-pointer hover:bg-raised")}
            >
              <td className="w-[34%] truncate px-4 py-2.5">
                <span className="flex items-center gap-2.5" title={`${timer.ref.id} → ${state.activates}`}>
                  <StatusDot tone={timerTone(state)} label={timerFailed(state) ? "last run failed" : state.activeState} />
                  <span className="truncate font-mono">{shortUnitName(timer.ref.id)}</span>
                  {state.scope === "user" ? <span className="shrink-0 text-xs text-subtle">user</span> : null}
                </span>
              </td>
              <td className="truncate px-4 py-2.5 text-muted-foreground">
                <LastRun timer={timer} />
              </td>
              <td className="w-32 whitespace-nowrap px-4 py-2.5 text-right text-subtle">
                {state.nextRunAt !== null ? <TimeUntil at={state.nextRunAt} prefix="next " /> : "not scheduled"}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
