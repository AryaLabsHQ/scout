import { cn } from "@/lib/utils"

interface ProgressBarProps {
  value: number // 0-100
  label?: string
  className?: string
}

function getBarColor(value: number): string {
  if (value >= 80) return "#ef4444"
  if (value >= 60) return "#f59e0b"
  return "#22c55e"
}

export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value))
  const color = getBarColor(clamped)

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
      {label !== undefined && (
        <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
          {label}
        </span>
      )}
    </div>
  )
}
