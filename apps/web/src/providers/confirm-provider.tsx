import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export interface ConfirmOptions {
  /** A question naming the action and its target, e.g. "Restart caddy.service on node-1?" */
  readonly title: string
  readonly description?: ReactNode
  /** The confirm button's verb, e.g. "Restart". */
  readonly confirmLabel: string
  /** Red confirm button for actions that stop, remove, or disable something. */
  readonly destructive?: boolean
  /** The exact command or call the action runs, shown verbatim. */
  readonly command?: string
  /** A secondary note under the command (permissions, side effects). */
  readonly note?: ReactNode
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm | null>(null)

/**
 * One app-wide confirm dialog. Every state-changing action in the dashboard
 * asks through `useConfirm()` before it calls the hub.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null)

  const settle = useCallback((confirmed: boolean) => {
    resolveRef.current?.(confirmed)
    resolveRef.current = null
    setOptions(null)
  }, [])

  const confirm = useCallback<Confirm>((next) => {
    resolveRef.current?.(false)
    setOptions(next)
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
    })
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={options !== null}
        onOpenChange={(open) => {
          if (!open) settle(false)
        }}
      >
        <AlertDialogContent className="data-[size=default]:sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold">{options?.title}</AlertDialogTitle>
            {options?.description ? (
              <AlertDialogDescription className="text-[13px] text-muted-foreground">
                {options.description}
              </AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          {options?.command ? (
            <pre className="overflow-x-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
              $ {options.command}
            </pre>
          ) : null}
          {options?.note ? <p className="text-xs text-subtle">{options.note}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={options?.destructive ? "destructive" : "default"}
              onClick={() => settle(true)}
            >
              {options?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext)
  if (confirm === null) throw new Error("useConfirm must be used inside ConfirmProvider")
  return confirm
}
