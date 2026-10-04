import type { ToolCall } from "@earendil-works/pi-ai"
import type { Provider } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  type FauxResponseFactory,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"

/**
 * A scripted local model for smoke-testing the operator without provider credentials
 * (`SCOUT_OPERATOR_MODEL_PROVIDER=faux`). Never selected unless configured.
 *
 * - `/tool <name> <json-args>` calls that tool.
 * - After a tool result, it reports the result text.
 * - Anything else is echoed back.
 */
export const scriptedFauxProvider = (): Provider => {
  const faux = fauxProvider({ models: [{ id: "scripted", name: "Scripted operator (faux)" }] })
  const respond: FauxResponseFactory = (context) => {
    // Keep exactly one factory queued so the script never runs out.
    faux.appendResponses([respond])
    // Positional system messages (prompt/tool changes) may follow the input; skip them.
    const last = context.messages.findLast((message) => message.role !== "system")
    if (last?.role === "toolResult") {
      const text = last.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n")
      return fauxAssistantMessage(`Tool ${last.toolName} returned:\n${text}`)
    }
    const prompt =
      last?.role === "user"
        ? typeof last.content === "string"
          ? last.content
          : last.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n")
        : ""
    const match = /^\/tool\s+(\S+)\s*(.*)$/s.exec(prompt.trim())
    if (match !== null) {
      const args = match[2]?.trim() ? (JSON.parse(match[2]) as ToolCall["arguments"]) : {}
      return fauxAssistantMessage(fauxToolCall(match[1]!, args), { stopReason: "toolUse" })
    }
    return fauxAssistantMessage(`Faux operator received: ${prompt}`)
  }
  faux.setResponses([respond])
  return faux.provider
}
