import { useState } from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { toast } from "sonner"

import { fetchAlertRulesSettings, fetchHealth } from "@/server/settings"
import { fetchSystems } from "@/server/systems"
import { useAtomSet } from "@effect/atom-react"
import { HubClient } from "@/rpc/client"

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmAction } from "@/components/confirm-action"
import { formatTimeAgo, formatBytes, formatDuration } from "@/lib/format"

import type { AlertRule, System } from "@scout/shared"
import type { HubHealth } from "@/server/settings"

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/settings")({
  loader: async () => {
    const [alertRules, systems, health] = await Promise.all([
      fetchAlertRulesSettings(),
      fetchSystems(),
      fetchHealth(),
    ])
    return { alertRules, systems, health }
  },
  component: SettingsPage,
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: AlertRule["severity"] }) {
  if (severity === "critical") {
    return (
      <Badge variant="destructive" className="text-[10px] uppercase tracking-wider px-1.5 py-0">
        Critical
      </Badge>
    )
  }
  return (
    <Badge className="text-[10px] uppercase tracking-wider px-1.5 py-0 bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/20">
      Warning
    </Badge>
  )
}

function StatusDot({ status }: { status: System["status"] }) {
  return (
    <span
      className={`inline-block size-2 rounded-full ${
        status === "online" ? "bg-green-500" : "bg-muted-foreground/40"
      }`}
    />
  )
}

// ── Edit Rule Sheet ───────────────────────────────────────────────────────────

interface EditRuleSheetProps {
  rule: AlertRule | null
  open: boolean
  onClose: () => void
  onSaved: (updated: AlertRule) => void
}

function EditRuleSheet({ rule, open, onClose, onSaved }: EditRuleSheetProps) {
  const [threshold, setThreshold] = useState("")
  const [consecutive, setConsecutive] = useState("")
  const [severity, setSeverity] = useState<"warning" | "critical">("warning")
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const runUpdateAlertRule = useAtomSet(
    HubClient.mutation("alertRules.update"),
    { mode: "promise" },
  )

  // Sync form with selected rule whenever it changes
  const prevRuleId = useState<string | null>(null)
  if (rule && rule.id !== prevRuleId[0]) {
    prevRuleId[1](rule.id)
    setThreshold(String(rule.threshold))
    setConsecutive(String(rule.consecutiveCount))
    setSeverity(rule.severity)
    setEnabled(rule.enabled)
  }

  async function handleSave() {
    if (!rule) return
    const t = Number(threshold)
    const c = Number(consecutive)
    if (!Number.isFinite(t) || t <= 0) {
      toast.error("Threshold must be greater than 0")
      return
    }
    if (!Number.isInteger(c) || c < 1) {
      toast.error("Consecutive count must be at least 1")
      return
    }
    setSaving(true)
    try {
      const updated = await runUpdateAlertRule({
        payload: {
          id: rule.id,
          threshold: t,
          consecutiveCount: c,
          severity,
          enabled,
        },
      })
      onSaved(updated)
      toast.success("Alert rule saved")
      onClose()
    } catch {
      toast.error("Failed to save rule")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-80 sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Edit Alert Rule</SheetTitle>
          {rule && (
            <SheetDescription>
              {rule.metric} {rule.operator} …
            </SheetDescription>
          )}
        </SheetHeader>

        {rule && (
          <div className="flex flex-col gap-4 px-4 py-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">Threshold</label>
              <Input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                min={0}
                step="any"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">Consecutive count</label>
              <Input
                type="number"
                value={consecutive}
                onChange={(e) => setConsecutive(e.target.value)}
                min={1}
                step={1}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">Severity</label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as "warning" | "critical")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground">Enabled</label>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>
          </div>
        )}

        <SheetFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ── Alert Rules Tab ───────────────────────────────────────────────────────────

function AlertRulesTab({ initialRules }: { initialRules: AlertRule[] }) {
  const [rules, setRules] = useState(initialRules)
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const runUpdateAlertRule = useAtomSet(
    HubClient.mutation("alertRules.update"),
    { mode: "promise" },
  )

  function handleEdit(rule: AlertRule) {
    setEditingRule(rule)
    setSheetOpen(true)
  }

  function handleSaved(updated: AlertRule) {
    setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
  }

  async function handleToggle(rule: AlertRule, enabled: boolean) {
    try {
      const updated = await runUpdateAlertRule({ payload: { id: rule.id, enabled } })
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    } catch {
      toast.error("Failed to update rule")
    }
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              <TableHead>Op</TableHead>
              <TableHead>Threshold</TableHead>
              <TableHead>Consec.</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                  No alert rules configured.
                </TableCell>
              </TableRow>
            )}
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell className="font-mono">{rule.metric}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{rule.operator}</TableCell>
                <TableCell>{rule.threshold}</TableCell>
                <TableCell>{rule.consecutiveCount}</TableCell>
                <TableCell>
                  <SeverityBadge severity={rule.severity} />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={(v) => handleToggle(rule, v)}
                    size="sm"
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => handleEdit(rule)}
                  >
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <EditRuleSheet
        rule={editingRule}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSaved={handleSaved}
      />
    </>
  )
}

// ── Agents Tab ────────────────────────────────────────────────────────────────

function AgentsTab({ initialSystems }: { initialSystems: System[] }) {
  const [systems, setSystems] = useState(initialSystems)
  const router = useRouter()
  const runRemoveSystem = useAtomSet(
    HubClient.mutation("systems.remove"),
    { mode: "promise" },
  )

  async function handleRemove(systemId: string) {
    try {
      await runRemoveSystem({ payload: { id: systemId } })
      setSystems((prev) => prev.filter((s) => s.id !== systemId))
      toast.success("Agent removed")
      router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove agent")
    }
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Hostname</TableHead>
            <TableHead>Tailscale IP</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Capabilities</TableHead>
            <TableHead>Last Seen</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {systems.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                No agents registered.
              </TableCell>
            </TableRow>
          )}
          {systems.map((system) => {
            const caps = system.capabilities
            const enabledCaps = Object.entries(caps)
              .filter(([, v]) => v)
              .map(([k]) => k)

            return (
              <TableRow key={system.id}>
                <TableCell className="font-mono">{system.hostname}</TableCell>
                <TableCell className="text-muted-foreground font-mono">
                  {system.tailscaleIp ?? "—"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <StatusDot status={system.status} />
                    <span className="capitalize text-xs">{system.status}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {enabledCaps.map((cap) => (
                      <Badge key={cap} variant="outline" className="text-[10px] px-1 py-0">
                        {cap}
                      </Badge>
                    ))}
                    {enabledCaps.length === 0 && (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {system.lastSeen ? formatTimeAgo(system.lastSeen) : "—"}
                </TableCell>
                <TableCell>
                  {system.status !== "online" ? (
                    <ConfirmAction
                      title="Remove agent"
                      description={`Remove "${system.hostname}" from Scout? This cannot be undone.`}
                      action="Remove"
                      variant="destructive"
                      onConfirm={() => handleRemove(system.id)}
                    >
                      <Button variant="destructive" size="xs">
                        Remove
                      </Button>
                    </ConfirmAction>
                  ) : (
                    <Button variant="outline" size="xs" disabled>
                      Remove
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

// ── Notifications Tab ─────────────────────────────────────────────────────────

function NotificationsTab() {
  const [inApp, setInApp] = useState(true)

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium">In-app notifications</p>
          <p className="text-xs text-muted-foreground">Show alert toasts in the browser.</p>
        </div>
        <Switch checked={inApp} onCheckedChange={setInApp} />
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Coming soon
        </p>

        <div className="flex items-center justify-between opacity-50">
          <div>
            <p className="text-xs font-medium">Discord webhook</p>
            <p className="text-xs text-muted-foreground">Post alerts to a Discord channel.</p>
          </div>
          <Input
            disabled
            placeholder="https://discord.com/api/webhooks/…"
            className="w-56"
          />
        </div>

        <div className="flex items-center justify-between opacity-50">
          <div>
            <p className="text-xs font-medium">Slack webhook</p>
            <p className="text-xs text-muted-foreground">Post alerts to a Slack channel.</p>
          </div>
          <Input
            disabled
            placeholder="https://hooks.slack.com/…"
            className="w-56"
          />
        </div>

        <div className="flex items-center justify-between opacity-50">
          <div>
            <p className="text-xs font-medium">Push notifications</p>
            <p className="text-xs text-muted-foreground">Browser push via PWA.</p>
          </div>
          <Switch disabled checked={false} />
        </div>
      </div>
    </div>
  )
}

// ── About Tab ─────────────────────────────────────────────────────────────────

function AboutTab({ health }: { health: HubHealth | null }) {
  return (
    <div className="max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>Hub Status</CardTitle>
        </CardHeader>
        <CardContent>
          {health === null ? (
            <p className="text-xs text-muted-foreground">Hub unreachable.</p>
          ) : (
            <dl className="flex flex-col gap-2">
              <div className="flex justify-between text-xs">
                <dt className="text-muted-foreground">Version</dt>
                <dd className="font-mono">{health.version}</dd>
              </div>
              <div className="flex justify-between text-xs">
                <dt className="text-muted-foreground">Uptime</dt>
                <dd>{formatDuration(health.uptime)}</dd>
              </div>
              <div className="flex justify-between text-xs">
                <dt className="text-muted-foreground">Database size</dt>
                <dd>{formatBytes(health.dbSizeBytes)}</dd>
              </div>
              <div className="flex justify-between text-xs">
                <dt className="text-muted-foreground">Connected agents</dt>
                <dd>{health.connectedAgents}</dd>
              </div>
              <div className="flex justify-between text-xs">
                <dt className="text-muted-foreground">Total systems</dt>
                <dd>{health.totalSystems}</dd>
              </div>
              <div className="flex justify-between text-xs">
                <dt className="text-muted-foreground">Active alerts</dt>
                <dd>{health.activeAlerts}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

function SettingsPage() {
  const { alertRules, systems, health } = Route.useLoaderData()

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="font-heading text-base font-semibold">Settings</h1>
        <p className="text-xs text-muted-foreground">Configure Scout and manage agents.</p>
      </div>

      <Tabs defaultValue="alert-rules">
        <TabsList>
          <TabsTrigger value="alert-rules">Alert Rules</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="about">About</TabsTrigger>
        </TabsList>

        <TabsContent value="alert-rules" className="pt-4">
          <AlertRulesTab initialRules={alertRules} />
        </TabsContent>

        <TabsContent value="agents" className="pt-4">
          <AgentsTab initialSystems={systems} />
        </TabsContent>

        <TabsContent value="notifications" className="pt-4">
          <NotificationsTab />
        </TabsContent>

        <TabsContent value="about" className="pt-4">
          <AboutTab health={health} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
