import { Extension, type Editor } from "@tiptap/core"

export interface PromptKeyboardOptions {
  onSubmit: () => void
  onHistoryUp: () => boolean
  onHistoryDown: () => boolean
}

export const PromptKeyboard = Extension.create<PromptKeyboardOptions>({
  name: "promptKeyboard",
  priority: 100,

  addOptions() {
    return {
      onSubmit: () => {},
      onHistoryUp: () => false,
      onHistoryDown: () => false,
    }
  },

  addKeyboardShortcuts() {
    const isSuggestionActive = () => {
      if (typeof document === "undefined") return false
      return Boolean(
        document.querySelector('.tippy-box[data-theme~="suggestion-dropdown"]:not([data-state="hidden"])'),
      )
    }

    return {
      Enter: ({ editor }: { editor: Editor }) => {
        if (editor.view.composing) return false
        if (isSuggestionActive()) return false
        this.options.onSubmit()
        return true
      },

      "Shift-Enter": ({ editor }: { editor: Editor }) => {
        const commands = editor.commands
        if (commands.newlineInCode?.()) return true
        if (commands.createParagraphNear?.()) return true
        if (commands.liftEmptyBlock?.()) return true
        if (commands.splitBlock?.()) return true
        return false
      },

      ArrowUp: ({ editor }: { editor: Editor }) => {
        if (isSuggestionActive()) return false
        const { from } = editor.state.selection
        const isAtStart = from <= 1
        const text = editor.getText()
        if (isAtStart || text.length < 100) {
          return this.options.onHistoryUp()
        }
        return false
      },

      ArrowDown: ({ editor }: { editor: Editor }) => {
        if (isSuggestionActive()) return false
        const { to } = editor.state.selection
        const docSize = editor.state.doc.content.size
        const isAtEnd = to >= docSize - 1
        const text = editor.getText()
        if (isAtEnd || text.length < 100) {
          return this.options.onHistoryDown()
        }
        return false
      },

      Escape: ({ editor }: { editor: Editor }) => {
        if (isSuggestionActive()) return false
        editor.commands.blur()
        return true
      },
    }
  },
})
