export interface MentionItem {
  id: string
  label: string
  type: "node"
  status?: "online" | "offline"
}

export interface SlashCommandItem {
  id: string
  trigger: string
  title: string
  description?: string
}
