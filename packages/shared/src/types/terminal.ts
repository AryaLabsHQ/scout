export type TerminalMode = "shell"

export interface TerminalSession {
  id: string
  agentId: string
  mode: TerminalMode
  cols: number
  rows: number
  createdAt: number
}
