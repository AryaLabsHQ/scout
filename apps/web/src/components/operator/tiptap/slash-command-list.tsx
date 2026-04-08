import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react"
import { cn } from "@/lib/utils"
import type { SlashCommandItem } from "./types"

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface SlashCommandListProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
}

export const SlashCommandList = forwardRef<SlashCommandListRef, SlashCommandListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    useEffect(() => {
      const item = items[selectedIndex]
      if (!item) return
      requestAnimationFrame(() => {
        const element = document.querySelector(`[data-slash-id="${item.id}"]`)
        element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
      })
    }, [selectedIndex, items])

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
          No matching commands
        </div>
      )
    }

    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-1 max-h-60 overflow-y-auto">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            data-slash-id={item.id}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
              index === selectedIndex && "bg-accent",
            )}
            onClick={() => command(item)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="text-foreground whitespace-nowrap">/{item.trigger}</span>
            {item.description && (
              <span className="text-muted-foreground truncate">{item.description}</span>
            )}
          </button>
        ))}
      </div>
    )
  },
)

SlashCommandList.displayName = "SlashCommandList"
