import { useId } from "react"
import { cn } from "@/lib/utils"
import type { StatusTone } from "./status-dot"

const STROKE: Record<StatusTone | "neutral", string> = {
  neutral: "var(--muted-foreground)",
  ok: "var(--status-ok)",
  warn: "var(--status-warn)",
  err: "var(--status-err)",
  off: "var(--status-off)",
}

/** A small, axis-free line for a metric's recent history. */
export function Sparkline({
  values,
  max,
  tone = "neutral",
  width = 120,
  height = 32,
  className,
}: {
  values: ReadonlyArray<number>
  /** Fixed ceiling (e.g. 100 for percentages); defaults to the series maximum. */
  max?: number
  tone?: StatusTone | "neutral"
  width?: number
  height?: number
  className?: string
}) {
  const gradientId = useId()
  if (values.length < 2) return <div style={{ width, height }} className={className} />
  const ceiling = max ?? Math.max(...values, Number.EPSILON)
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width
    const y = height - 1 - (Math.min(value, ceiling) / ceiling) * (height - 3)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const line = points.join(" ")
  const stroke = STROKE[tone]
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("block shrink-0", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.14} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon fill={`url(#${gradientId})`} points={`0,${height} ${line} ${width},${height}`} />
      <polyline fill="none" stroke={stroke} strokeWidth={1.25} strokeLinejoin="round" points={line} />
    </svg>
  )
}
