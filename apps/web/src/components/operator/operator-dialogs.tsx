import type { OperatorSkill, System } from "@scout/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { defaultSessionTitle } from "./operator-utils"

export function CreateSessionDialog({
  open,
  systems,
  availableSkills,
  draftTitle,
  selectedNodeIds,
  selectedSkillIds,
  isCreating,
  onOpenChange,
  onToggleNode,
  onToggleSkill,
  onTitleChange,
  onCreate,
}: {
  open: boolean
  systems: ReadonlyArray<System>
  availableSkills: ReadonlyArray<OperatorSkill>
  draftTitle: string
  selectedNodeIds: ReadonlyArray<string>
  selectedSkillIds: ReadonlyArray<string>
  isCreating: boolean
  onOpenChange: (open: boolean) => void
  onToggleNode: (nodeId: string, checked: boolean) => void
  onToggleSkill: (skillId: string, checked: boolean) => void
  onTitleChange: (title: string) => void
  onCreate: () => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create Operator Session</DialogTitle>
          <DialogDescription>
            Pick an explicit node scope before the operator can start. Sessions begin with no nodes selected
            by default.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="operator-session-title"
              className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground"
            >
              Title
            </label>
            <Input
              id="operator-session-title"
              value={draftTitle}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder={defaultSessionTitle(selectedNodeIds.length)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Node Scope
              </p>
              <Badge variant="outline">{selectedNodeIds.length} selected</Badge>
            </div>

            {systems.length === 0 ? (
              <div className="rounded-none border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                No online nodes are available right now.
              </div>
            ) : (
              <ScrollArea className="max-h-72 border border-border">
                <div className="space-y-2 p-3">
                  {systems.map((system) => {
                    const checked = selectedNodeIds.includes(system.id)
                    return (
                      <label
                        key={system.id}
                        className="flex cursor-pointer items-start justify-between gap-3 border border-border px-3 py-2 text-left transition-colors hover:bg-muted/40"
                      >
                        <div className="space-y-1">
                          <div className="text-sm font-medium">{system.hostname}</div>
                          <div className="text-[11px] text-muted-foreground">{system.id}</div>
                        </div>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(nextChecked) => onToggleNode(system.id, nextChecked === true)}
                        />
                      </label>
                    )
                  })}
                </div>
              </ScrollArea>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Skills
              </p>
              <Badge variant="outline">{selectedSkillIds.length} attached</Badge>
            </div>

            {availableSkills.length === 0 ? (
              <div className="rounded-none border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                No operator skills are available right now.
              </div>
            ) : (
              <ScrollArea className="max-h-48 border border-border">
                <div className="space-y-2 p-3">
                  {availableSkills.map((skill) => {
                    const checked = selectedSkillIds.includes(skill.id)
                    return (
                      <label
                        key={skill.id}
                        className="flex cursor-pointer items-start justify-between gap-3 border border-border px-3 py-2 text-left transition-colors hover:bg-muted/40"
                      >
                        <div className="space-y-1">
                          <div className="text-sm font-medium">{skill.name}</div>
                          <div className="text-[11px] text-muted-foreground">{skill.description}</div>
                        </div>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(nextChecked) => onToggleSkill(skill.id, nextChecked === true)}
                        />
                      </label>
                    )
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void onCreate()} disabled={selectedNodeIds.length === 0 || isCreating}>
            {isCreating ? "Creating..." : "Start Session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ManageSkillsDialog({
  open,
  skills,
  selectedSkillIds,
  isSaving,
  onOpenChange,
  onToggleSkill,
  onSave,
}: {
  open: boolean
  skills: ReadonlyArray<OperatorSkill>
  selectedSkillIds: ReadonlyArray<string>
  isSaving: boolean
  onOpenChange: (open: boolean) => void
  onToggleSkill: (skillId: string, checked: boolean) => void
  onSave: () => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Manage Skills</DialogTitle>
          <DialogDescription>
            Attach operator skills to this session. Attached skills are included in prompt construction for
            future turns.
          </DialogDescription>
        </DialogHeader>

        {skills.length === 0 ? (
          <div className="rounded-none border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
            No operator skills are available right now.
          </div>
        ) : (
          <ScrollArea className="max-h-80 border border-border">
            <div className="space-y-2 p-3">
              {skills.map((skill) => {
                const checked = selectedSkillIds.includes(skill.id)
                return (
                  <label
                    key={skill.id}
                    className="flex cursor-pointer items-start justify-between gap-3 border border-border px-3 py-2 text-left transition-colors hover:bg-muted/40"
                  >
                    <div className="space-y-1">
                      <div className="text-sm font-medium">{skill.name}</div>
                      <div className="text-[11px] text-muted-foreground">{skill.description}</div>
                    </div>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(nextChecked) => onToggleSkill(skill.id, nextChecked === true)}
                    />
                  </label>
                )
              })}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void onSave()} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Skills"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
