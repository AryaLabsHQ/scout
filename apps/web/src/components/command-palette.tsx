import { HugeiconsIcon } from "@hugeicons/react"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { useCommandPalette } from "@/providers/command-palette-provider"
import { useCommands, type Command as ScoutCommand, type CommandGroup as ScoutCommandGroup } from "@/hooks/use-commands"

// Fixed group order for consistent palette layout
const GROUP_ORDER: ScoutCommandGroup[] = ["Navigation", "Terminal", "System", "Alerts"]

export function CommandPalette() {
  const { isOpen, setOpen, close } = useCommandPalette()
  const commands = useCommands()

  // Group commands by their group field, preserving insertion order within
  // each group
  const grouped = new Map<ScoutCommandGroup, ScoutCommand[]>()
  for (const cmd of commands) {
    const bucket = grouped.get(cmd.group) ?? []
    bucket.push(cmd)
    grouped.set(cmd.group, bucket)
  }

  const run = (cmd: ScoutCommand) => {
    const result = cmd.perform()
    // Commands can return `false` to keep the palette open; otherwise close.
    if (result !== false) close()
  }

  return (
    <CommandDialog open={isOpen} onOpenChange={setOpen}>
      <Command>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {GROUP_ORDER.map((groupName) => {
            const items = grouped.get(groupName)
            if (!items || items.length === 0) return null
            return (
              <CommandGroup key={groupName} heading={groupName}>
                {items.map((cmd) => (
                  <CommandItem
                    key={cmd.id}
                    value={cmd.id}
                    keywords={[cmd.label, ...(cmd.keywords ?? [])]}
                    onSelect={() => run(cmd)}
                  >
                    {cmd.icon && <HugeiconsIcon icon={cmd.icon} size={14} />}
                    <span>{cmd.label}</span>
                    {cmd.shortcut && <CommandShortcut>{cmd.shortcut}</CommandShortcut>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )
          })}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
