import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import Mention from "@tiptap/extension-mention"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUp01Icon, Image02Icon } from "@hugeicons/core-free-icons"
import type { OperatorModelDescriptor, OperatorSkill, System } from "@scout/shared"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  NodeMentionExtension,
  createNodeMentionSuggestion,
  createSlashSuggestion,
  PromptKeyboard,
  AttachmentHandler,
  type SlashCommandItem,
} from "./tiptap"
import "./tiptap/prompt-input.css"

const HISTORY_KEY = "scout:operator:prompt-history"
const MAX_HISTORY = 50

interface OperatorPromptInputProps {
  draft: string
  setDraft: (v: string) => void
  isSubmitting: boolean
  onSubmit: () => void
  bypassMode: string
  nodeCount: number
  systems: ReadonlyArray<System>
  skills: ReadonlyArray<OperatorSkill>
  models: ReadonlyArray<OperatorModelDescriptor>
  selectedNodeIds: ReadonlyArray<string>
  modelId: string
  modelProviderId: string
  onModelChange?: (providerId: string, modelId: string) => void
  onNodeToggle?: (nodeId: string, checked: boolean) => void
  fillRef?: React.MutableRefObject<((text: string) => void) | null>
}

export function OperatorPromptInput({
  draft,
  setDraft,
  isSubmitting,
  onSubmit,
  bypassMode,
  systems,
  skills,
  models,
  selectedNodeIds,
  modelId,
  modelProviderId,
  onModelChange,
  onNodeToggle,
  fillRef,
}: OperatorPromptInputProps) {
  const [attachments, setAttachments] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const savedDraftRef = useRef("")
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY)
      if (stored) {
        historyRef.current = JSON.parse(stored) as string[]
      }
    } catch {
      // ignore
    }
  }, [])

  const pushHistory = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (historyRef.current[historyRef.current.length - 1] === trimmed) return
    historyRef.current.push(trimmed)
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current = historyRef.current.slice(-MAX_HISTORY)
    }
    historyIndexRef.current = -1
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(historyRef.current))
    } catch {
      // ignore
    }
  }, [])

  const navigateHistory = useCallback(
    (direction: -1 | 1): boolean => {
      const history = historyRef.current
      if (history.length === 0) return false

      const ed = editorRef.current
      if (historyIndexRef.current === -1) {
        savedDraftRef.current = ed?.getText() ?? ""
      }

      const newIndex =
        historyIndexRef.current === -1
          ? direction === -1
            ? history.length - 1
            : -1
          : historyIndexRef.current + direction

      if (newIndex < -1 || newIndex >= history.length) return false

      historyIndexRef.current = newIndex

      const content =
        newIndex === -1 ? savedDraftRef.current : history[newIndex] ?? ""

      ed?.commands.setContent(content ? `<p>${content}</p>` : "")
      setDraft(content)
      return true
    },
    [setDraft],
  )

  const handleSubmitRef = useRef(onSubmit)
  handleSubmitRef.current = onSubmit

  const isSubmittingRef = useRef(isSubmitting)
  isSubmittingRef.current = isSubmitting

  const handleSubmit = useCallback(() => {
    if (isSubmittingRef.current) return
    const ed = editorRef.current
    const text = ed?.getText().trim() ?? ""
    if (!text) return
    pushHistory(text)
    historyIndexRef.current = -1
    handleSubmitRef.current()
    // Clear editor after submit
    requestAnimationFrame(() => {
      ed?.commands.clearContent()
      setDraft("")
    })
  }, [pushHistory, setDraft])

  const handleSubmitStableRef = useRef(handleSubmit)
  handleSubmitStableRef.current = handleSubmit

  const navigateHistoryStableRef = useRef(navigateHistory)
  navigateHistoryStableRef.current = navigateHistory

  const builtinCommands: SlashCommandItem[] = useMemo(
    () => [
      { id: "cmd:clear", trigger: "clear", title: "Clear", description: "Clear prompt" },
    ],
    [],
  )

  const skillCommands: SlashCommandItem[] = useMemo(
    () =>
      skills.map((skill) => ({
        id: `skill:${skill.id}`,
        trigger: skill.name.toLowerCase().replace(/\s+/g, "-"),
        title: skill.name,
        description: skill.description,
      })),
    [skills],
  )

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      NodeMentionExtension.configure({
        HTMLAttributes: { class: "mention-pill" },
        suggestion: createNodeMentionSuggestion({
          getItems: (query) =>
            systems
              .filter(
                (s) =>
                  s.hostname.toLowerCase().includes(query.toLowerCase()) ||
                  s.id.toLowerCase().includes(query.toLowerCase()),
              )
              .map((s) => ({
                id: s.id,
                label: s.hostname,
                type: "node" as const,
                status: s.status as "online" | "offline",
              })),
        }),
      }),
      Mention.extend({ name: "slashCommand" }).configure({
        suggestion: createSlashSuggestion({
          getItems: (query) =>
            [...builtinCommands, ...skillCommands].filter((c) =>
              c.trigger.includes(query.toLowerCase()),
            ),
          onSelect: (item) => {
            const ed = editorRef.current
            if (item.id === "cmd:clear") {
              ed?.commands.clearContent()
              setDraft("")
            }
            if (item.id.startsWith("skill:")) {
              ed?.chain().focus().insertContent(`/${item.trigger} `).run()
            }
          },
        }),
      }),
      Placeholder.configure({
        placeholder: "Ask Scout to investigate, inspect state, or prepare a plan...",
      }),
      PromptKeyboard.configure({
        onSubmit: () => handleSubmitStableRef.current(),
        onHistoryUp: () => navigateHistoryStableRef.current(-1),
        onHistoryDown: () => navigateHistoryStableRef.current(1),
      }),
      AttachmentHandler.configure({
        onAttachment: (file: File) => setAttachments((prev) => [...prev, file]),
      }),
    ],
    editorProps: {
      attributes: {
        class: "text-xs text-foreground focus:outline-none",
      },
    },
    onUpdate: ({ editor: e }) => {
      setDraft(e.getText())
    },
  })

  // Keep editorRef in sync
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // Expose fill method for suggestion chips
  useEffect(() => {
    if (fillRef) {
      fillRef.current = (text: string) => {
        editor?.commands.setContent(`<p>${text}</p>`)
        setDraft(text)
        editor?.commands.focus("end")
      }
    }
  }, [editor, fillRef, setDraft])

  const hasContent = draft.trim().length > 0

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files) return
    for (const file of files) {
      setAttachments((prev) => [...prev, file])
    }
    event.target.value = ""
  }, [])

  return (
    <div className="border-t border-border">
      {/* Image thumbnails */}
      {attachments.length > 0 && (
        <div className="flex gap-2 px-4 pt-3">
          {attachments.map((file, i) => (
            <div key={`${file.name}-${i}`} className="relative size-16 rounded-md border border-border overflow-hidden bg-muted">
              <img
                src={URL.createObjectURL(file)}
                alt={file.name}
                className="size-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Editor */}
      <div className="operator-editor max-h-48 overflow-y-auto scrollbar-thin">
        <EditorContent editor={editor} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-border/50">
        <div className="flex items-center gap-2">
          {/* Attach button */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button size="icon" variant="ghost" className="size-7" onClick={openFilePicker} />
              }
            >
              <HugeiconsIcon icon={Image02Icon} size={14} />
            </TooltipTrigger>
            <TooltipContent>Attach image</TooltipContent>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Node scope */}
          {onNodeToggle ? (
            <Popover>
              <PopoverTrigger
                render={
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" />
                }
              >
                {selectedNodeIds.length} node{selectedNodeIds.length === 1 ? "" : "s"}
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start">
                {systems.map((system) => (
                  <label
                    key={system.id}
                    className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted/40 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedNodeIds.includes(system.id)}
                      onCheckedChange={(checked) =>
                        onNodeToggle(system.id, checked === true)
                      }
                    />
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        system.status === "online"
                          ? "bg-emerald-500"
                          : "bg-muted-foreground/40",
                      )}
                    />
                    <span>{system.hostname}</span>
                  </label>
                ))}
              </PopoverContent>
            </Popover>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {selectedNodeIds.length} node{selectedNodeIds.length === 1 ? "" : "s"}
            </span>
          )}

          {/* Model selector */}
          {onModelChange ? (
            <Popover>
              <PopoverTrigger
                render={
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" />
                }
              >
                {modelProviderId}/{modelId}
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2 max-h-60 overflow-y-auto" align="start">
                {models.map((model) => (
                  <button
                    key={`${model.providerId}:${model.modelId}`}
                    type="button"
                    onClick={() => onModelChange(model.providerId, model.modelId)}
                    className={cn(
                      "flex w-full items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-muted/40 rounded-sm",
                      model.modelId === modelId &&
                        model.providerId === modelProviderId &&
                        "bg-accent",
                    )}
                  >
                    <span>{model.label}</span>
                    {model.reasoning && (
                      <Badge variant="outline" className="text-[9px]">
                        reasoning
                      </Badge>
                    )}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {modelProviderId}/{modelId}
            </span>
          )}

          {/* Bypass indicator */}
          {bypassMode === "timed_override" && (
            <Badge variant="outline" className="text-[10px] uppercase">
              bypass
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Kbd className="text-[10px]">⏎</Kbd>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon"
                  onClick={handleSubmit}
                  disabled={isSubmitting || !hasContent}
                  className="size-7"
                />
              }
            >
              {isSubmitting ? (
                <Spinner className="size-3.5" />
              ) : (
              <HugeiconsIcon icon={ArrowUp01Icon} size={14} />
            )}
            </TooltipTrigger>
            <TooltipContent>{isSubmitting ? "Sending..." : "Send (Enter)"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
