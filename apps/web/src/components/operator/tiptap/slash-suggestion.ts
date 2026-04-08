import { ReactRenderer } from "@tiptap/react"
import tippy, { type Instance as TippyInstance } from "tippy.js"
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion"
import { SlashCommandList, type SlashCommandListRef } from "./slash-command-list"
import type { SlashCommandItem } from "./types"

export interface SlashSuggestionConfig {
  getItems: (query: string) => SlashCommandItem[]
  onSelect: (item: SlashCommandItem) => void
}

export function createSlashSuggestion(
  config: SlashSuggestionConfig,
): Omit<SuggestionOptions<SlashCommandItem>, "editor"> {
  return {
    char: "/",
    allowSpaces: false,
    startOfLine: false,

    items: ({ query }) => {
      return config.getItems(query)
    },

    command: ({ editor, range, props }) => {
      editor.chain().focus().deleteRange(range).run()
      config.onSelect(props)
    },

    render: () => {
      let component: ReactRenderer<SlashCommandListRef> | null = null
      let popup: TippyInstance[] | null = null

      return {
        onStart: (props: SuggestionProps<SlashCommandItem>) => {
          component = new ReactRenderer(SlashCommandList, {
            props: {
              items: props.items,
              command: props.command,
            },
            editor: props.editor,
          })

          if (!props.clientRect) return

          popup = tippy("body", {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "top-start",
            theme: "suggestion-dropdown",
          })
        },

        onUpdate: (props: SuggestionProps<SlashCommandItem>) => {
          component?.updateProps({
            items: props.items,
            command: props.command,
          })

          if (!props.clientRect) return

          popup?.[0]?.setProps({
            getReferenceClientRect: props.clientRect as () => DOMRect,
          })
        },

        onKeyDown: (props: { event: KeyboardEvent }) => {
          if (props.event.key === "Escape") {
            popup?.[0]?.hide()
            return true
          }
          const handled = component?.ref?.onKeyDown(props) ?? false
          if (handled) return true
          if (
            props.event.key === "ArrowUp" ||
            props.event.key === "ArrowDown" ||
            props.event.key === "Enter" ||
            props.event.key === "Tab"
          ) {
            props.event.preventDefault()
            return true
          }
          return false
        },

        onExit: () => {
          popup?.[0]?.destroy()
          component?.destroy()
        },
      }
    },
  }
}
