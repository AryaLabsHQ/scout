export type TerminalMode = "shell" | "podExec"

export interface TerminalSession {
  id: string
  agentId: string
  mode: TerminalMode
  podName: string | null
  namespace: string | null
  cols: number
  rows: number
  createdAt: number
}
