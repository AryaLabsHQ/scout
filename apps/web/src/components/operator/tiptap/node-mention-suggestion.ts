import { ReactRenderer } from "@tiptap/react"
import tippy, { type Instance as TippyInstance } from "tippy.js"
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion"
import { NodeMentionList, type NodeMentionListRef } from "./node-mention-list"
import type { MentionItem } from "./types"

export interface NodeMentionSuggestionConfig {
  getItems: (query: string) => MentionItem[]
}

export function createNodeMentionSuggestion(
  config: NodeMentionSuggestionConfig,
): Omit<SuggestionOptions<MentionItem>, "editor"> {
  return {
    char: "@",
    allowSpaces: false,

    items: ({ query }) => {
      return config.getItems(query)
    },

    command: ({ editor, range, props: item }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          {
            type: "nodeMention",
            attrs: {
              id: item.id,
              label: item.label,
              mentionType: "node",
            },
          },
          { type: "text", text: " " },
        ])
        .run()
    },

    render: () => {
      let component: ReactRenderer<NodeMentionListRef> | null = null
      let popup: TippyInstance[] | null = null

      return {
        onStart: (props: SuggestionProps<MentionItem>) => {
          component = new ReactRenderer(NodeMentionList, {
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

        onUpdate: (props: SuggestionProps<MentionItem>) => {
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
