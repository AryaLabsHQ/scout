import { formatTimeAgo } from "@/lib/format"

/**
 * "5m ago" for a timestamp. The server render and hydration can straddle a
 * minute boundary, so the text is allowed to differ on hydration.
 */
export function TimeAgo({ at, prefix = "" }: { at: number; prefix?: string }) {
  return (
    <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()} suppressHydrationWarning>
      {prefix}
      {formatTimeAgo(at)}
    </time>
  )
}
