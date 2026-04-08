import { Extension } from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"

export interface AttachmentHandlerOptions {
  onAttachment: (file: File) => void
  acceptedTypes: string[]
}

export const AttachmentHandler = Extension.create<AttachmentHandlerOptions>({
  name: "attachmentHandler",

  addOptions() {
    return {
      onAttachment: () => {},
      acceptedTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
    }
  },

  addProseMirrorPlugins() {
    const { onAttachment, acceptedTypes } = this.options

    return [
      new Plugin({
        props: {
          handlePaste: (_view: EditorView, event: ClipboardEvent) => {
            const items = event.clipboardData?.items
            if (!items) return false

            let handled = false
            for (const item of items) {
              if (acceptedTypes.includes(item.type)) {
                const file = item.getAsFile()
                if (file) {
                  onAttachment(file)
                  handled = true
                }
              }
            }

            if (handled) {
              event.preventDefault()
              return true
            }
            return false
          },

          handleDrop: (_view: EditorView, event: DragEvent) => {
            const files = event.dataTransfer?.files
            if (!files?.length) return false

            let handled = false
            for (const file of files) {
              if (acceptedTypes.includes(file.type)) {
                onAttachment(file)
                handled = true
              }
            }

            if (handled) {
              event.preventDefault()
              return true
            }
            return false
          },
        },
      }),
    ]
  },
})
