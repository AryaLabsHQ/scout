import { cn } from "@/lib/utils"

export type StatusTone = "ok" | "warn" | "err" | "off"

const TONE_CLASS: Record<StatusTone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  off: "bg-off",
}

/** The only place colour appears for state: a small dot. */
export function StatusDot({
  tone,
  pulse = false,
  className,
  label,
}: {
  tone: StatusTone
  pulse?: boolean
  className?: string
  /** Accessible name; the dot alone carries no text. */
  label?: string
}) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("inline-block size-2 shrink-0 rounded-full", TONE_CLASS[tone], pulse && "live-pulse", className)}
    />
  )
}
