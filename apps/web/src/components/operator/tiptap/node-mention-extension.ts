import Mention from "@tiptap/extension-mention"

export const NodeMentionExtension = Mention.extend({
  name: "nodeMention",

  addAttributes() {
    return {
      ...this.parent?.(),
      mentionType: {
        default: "node",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-mention-type"),
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-mention-type": attributes.mentionType ?? "node",
        }),
      },
    }
  },

  renderText({ node }: { node: { attrs: Record<string, unknown> } }) {
    const label = (node.attrs.label as string) ?? (node.attrs.id as string) ?? ""
    if (!label) return ""
    return `@${label}`
  },
})
