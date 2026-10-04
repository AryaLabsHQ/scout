import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react"
import { cn } from "@/lib/utils"
import type { MentionItem } from "./types"

export interface NodeMentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface NodeMentionListProps {
  items: MentionItem[]
  command: (item: MentionItem) => void
}

export const NodeMentionList = forwardRef<NodeMentionListRef, NodeMentionListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === "ArrowUp") {
          event.preventDefault()
          if (!items.length) return true
          setSelectedIndex((i) => (i <= 0 ? items.length - 1 : i - 1))
          return true
        }
        if (event.key === "ArrowDown") {
          event.preventDefault()
          if (!items.length) return true
          setSelectedIndex((i) => (i >= items.length - 1 ? 0 : i + 1))
          return true
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const item = items[selectedIndex]
          if (item) {
            event.preventDefault()
            command(item)
          }
          return true
        }
        return false
      },
    }))

    if (items.length === 0) {
      return (
        <div className="bg-popover border border-border rounded-lg shadow-lg p-2 text-xs text-muted-foreground">
          No matching nodes
        </div>
      )
    }

    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-1 max-h-60 overflow-y-auto">
        {items.slice(0, 10).map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
              index === selectedIndex && "bg-accent",
            )}
            onClick={() => command(item)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                item.status === "online" ? "bg-ok" : "bg-muted-foreground/40",
              )}
            />
            <span className="text-foreground">{item.label}</span>
            <span className="ml-auto text-[10px] text-muted-foreground truncate max-w-24">
              {item.id}
            </span>
          </button>
        ))}
      </div>
    )
  },
)

NodeMentionList.displayName = "NodeMentionList"
