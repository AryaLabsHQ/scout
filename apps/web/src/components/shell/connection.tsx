import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { StatusDot } from "@/components/status-dot"
import { useHubConnection } from "@/lib/hub-connection"

/** How long a dropped socket may retry quietly before the banner offers a reload. */
const DISCONNECT_GRACE_MS = 8_000

function useNow(intervalMs: number, enabled: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [enabled, intervalMs])
  return now
}

/** Top-bar indicator driven by the real socket state, not by cached query results. */
export function LiveIndicator() {
  const connection = useHubConnection()
  const [tone, label] = connection.unauthorized
    ? (["off", "Signed out"] as const)
    : connection.status === "connected"
      ? (["ok", "Live"] as const)
      : connection.status === "disconnected"
        ? (["warn", "Reconnecting"] as const)
        : (["off", "Connecting"] as const)
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
      <StatusDot tone={tone} pulse={tone === "ok"} />
      {label}
    </span>
  )
}

/**
 * Full-width banner under the top bar. When the hub answers `Unauthorized` the
 * Access session has expired: live updates have stopped and a reload goes back
 * through Access to sign in again. A socket that stays down past a short grace
 * period gets the same reload offer, since an expired session can also surface
 * as a refused websocket upgrade.
 */
export function SessionBanner() {
  const connection = useHubConnection()
  const down = connection.status === "disconnected"
  const now = useNow(1_000, down && !connection.unauthorized)
  const longDown = down && now - connection.since > DISCONNECT_GRACE_MS

  if (!connection.unauthorized && !longDown) return null

  const stoppedAt = new Date(connection.lastMessageAt ?? connection.since).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-warn/25 bg-warn/[0.06] px-5 py-2.5 text-[13px]"
    >
      <StatusDot tone="warn" />
      {connection.unauthorized ? (
        <span>
          <span className="font-medium">Your Cloudflare Access session expired.</span>{" "}
          <span className="text-muted-foreground">
            Live updates stopped at {stoppedAt}; the data below is stale.
          </span>
        </span>
      ) : (
        <span>
          <span className="font-medium">Lost connection to the hub.</span>{" "}
          <span className="text-muted-foreground">
            Retrying since {stoppedAt}. If your Access session expired, reload to sign in.
          </span>
        </span>
      )}
      <Button size="sm" className="ml-auto" onClick={() => window.location.reload()}>
        Reload to sign in
      </Button>
    </div>
  )
}
