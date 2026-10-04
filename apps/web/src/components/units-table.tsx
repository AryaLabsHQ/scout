import { useNavigate } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import { MoreHorizontalIcon } from "@hugeicons/core-free-icons"
import type { EntitySnapshot } from "@scout/plugin-sdk"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { StatusDot } from "@/components/status-dot"
import { shortUnitName, unitState, unitTone, type UnitActionKind } from "@/lib/systemd"
import { cn } from "@/lib/utils"

export function PinButton({ pinned, onToggle, className }: { pinned: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      title={pinned ? "Unpin from overview" : "Pin to overview"}
      aria-label={pinned ? "Unpin from overview" : "Pin to overview"}
      aria-pressed={pinned}
      className={cn(
        "inline-grid size-7 place-items-center rounded-md hover:bg-muted",
        pinned ? "text-foreground" : "text-subtle hover:text-foreground",
        className,
      )}
    >
      <span aria-hidden className="text-sm leading-none">{pinned ? "★" : "☆"}</span>
    </button>
  )
}

export function UnitActionsMenu({
  unitId,
  pinned,
  onAction,
  onTogglePin,
  onOpen,
}: {
  unitId: string
  pinned: boolean
  onAction: (kind: UnitActionKind) => void
  onTogglePin: () => void
  onOpen?: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            onClick={(event) => event.stopPropagation()}
            className="inline-grid size-7 place-items-center rounded-md text-subtle hover:bg-muted hover:text-foreground"
            aria-label={`Actions for ${unitId}`}
          />
        }
      >
        <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate font-mono">{unitId}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onAction("start")}>Start…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAction("restart")}>Restart…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAction("stop")}>Stop…</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onAction("enable")}>Enable…</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction("disable")}>Disable…</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onTogglePin}>{pinned ? "Unpin from overview" : "Pin to overview"}</DropdownMenuItem>
        {onOpen ? <DropdownMenuItem onClick={onOpen}>Open details</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * systemd units as compact rows: optional pin star, status dot, unit name,
 * description, sub-state, and an optional ⋯ menu. Rows open the unit page.
 */
export function UnitsTable({
  systemId,
  units,
  isPinned,
  onTogglePin,
  onAction,
  showHeader = false,
}: {
  systemId: string
  units: ReadonlyArray<EntitySnapshot>
  isPinned: (unitId: string) => boolean
  onTogglePin?: (unitId: string) => void
  onAction?: (kind: UnitActionKind, unitId: string) => void
  showHeader?: boolean
}) {
  const navigate = useNavigate()
  const open = (unitId: string) =>
    void navigate({ to: "/systems/$systemId/services/$unitId", params: { systemId, unitId } })

  return (
    <table className="w-full table-fixed text-left text-[13px]">
      {showHeader ? (
        <thead>
          <tr className="border-b border-border bg-raised text-xs text-subtle">
            {onTogglePin ? <th className="w-11 px-2 py-2 font-normal" aria-label="Pinned" /> : null}
            <th className="w-[34%] px-4 py-2 font-normal">Unit</th>
            <th className="px-4 py-2 font-normal">Description</th>
            <th className="w-28 px-4 py-2 text-right font-normal">State</th>
            {onAction ? <th className="w-12 px-2 py-2 font-normal" aria-label="Actions" /> : null}
          </tr>
        </thead>
      ) : null}
      <tbody>
        {units.map((unit) => {
          const state = unitState(unit)
          const id = unit.ref.id
          const pinned = isPinned(id)
          return (
            <tr
              key={id}
              onClick={() => open(id)}
              className="cursor-pointer border-t border-border first:border-t-0 hover:bg-raised"
            >
              {onTogglePin ? (
                <td className="w-11 px-2 py-1.5">
                  <PinButton pinned={pinned} onToggle={() => onTogglePin(id)} />
                </td>
              ) : null}
              <td className={cn("truncate px-4 py-2.5", showHeader ? "w-[34%]" : "w-[46%]")}>
                <span className="flex items-center gap-2.5">
                  <StatusDot tone={unitTone(state)} label={state.activeState} />
                  <span className="truncate font-mono text-[13px]">{shortUnitName(id)}</span>
                </span>
              </td>
              <td className="truncate px-4 py-2.5 text-muted-foreground">{state.description}</td>
              <td
                className={cn(
                  "w-24 px-4 py-2.5 text-right",
                  state.activeState === "failed" ? "text-err" : "text-subtle",
                )}
              >
                {state.activeState === "failed" ? "failed" : state.subState}
              </td>
              {onAction ? (
                <td className="w-12 px-2 py-1.5 text-right">
                  <UnitActionsMenu
                    unitId={id}
                    pinned={pinned}
                    onAction={(kind) => onAction(kind, id)}
                    onTogglePin={() => onTogglePin?.(id)}
                    onOpen={() => open(id)}
                  />
                </td>
              ) : null}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
