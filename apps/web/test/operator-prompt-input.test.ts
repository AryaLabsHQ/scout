import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { Editor } from "@tiptap/core"
import { StarterKit } from "@tiptap/starter-kit"
import { renderToStaticMarkup } from "react-dom/server"
import {
  OperatorPromptInput,
  textDocument,
  synchronizePromptEditor,
} from "../src/components/operator/operator-prompt-input"
import {
  DEFAULT_IMAGE_INPUT,
  imageBlob,
  readDraftImage,
  validateImageContainer,
} from "../src/components/operator/operator-image-input"

const image = {
  id: "i",
  name: "image.png",
  mimeType: "image/png",
  data: "AQID",
  byteLength: 3,
  width: 1,
  height: 1,
}
function renderInput(overrides: Partial<Parameters<typeof OperatorPromptInput>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(OperatorPromptInput, {
      draft: "",
      setDraft: () => {},
      isSubmitting: false,
      onSubmit: () => {},
      approvalMode: "confirm_each_mutation",
      nodeCount: 0,
      systems: [],
      skills: [],
      models: [],
      selectedNodeIds: [],
      modelId: "vision",
      modelProviderId: "fixture",
      imageInput: DEFAULT_IMAGE_INPUT,
      onImagesChange: () => {},
      images: [],
      onInputError: () => {},
      isRestoring: false,
      admissionError: null,
      storageError: null,
      pendingAttempt: null,
      conflicts: [],
      onRecover: () => {},
      onRetry: () => {},
      onDiscard: () => {},
      ...overrides,
    }),
  )
}
const button = (html: string, label: string) =>
  html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0]

describe("operator composer component boundary", () => {
  it("enables image-only submission and restricts picker formats", () => {
    const html = renderInput({ images: [image] })
    expect(button(html, "Send prompt")).toBeDefined()
    expect(button(html, "Send prompt")).not.toMatch(/\sdisabled(?:=|[ >])|aria-disabled="true"/)
    expect(html).toContain('accept="image/png,image/jpeg,image/webp"')
    expect(html).toContain('aria-label="Remove image.png"')
    expect(html).not.toContain(image.data)
  })

  it("blocks empty input, restoration and duplicate sends while allowing visible draft edits", () => {
    expect(button(renderInput(), "Send prompt")).toMatch(/\sdisabled(?:=|[ >])|aria-disabled="true"/)
    expect(button(renderInput({ draft: "saved", isRestoring: true }), "Send prompt")).toMatch(
      /\sdisabled(?:=|[ >])|aria-disabled="true"/,
    )
    expect(button(renderInput({ draft: "saved", isSubmitting: true }), "Send prompt")).toMatch(
      /\sdisabled(?:=|[ >])|aria-disabled="true"/,
    )
    const html = renderInput({
      draft: "newer",
      pendingAttempt: {
        sessionId: "s",
        requestId: "r",
        draft: { id: "old", text: "original", images: [image] },
      },
      admissionError: "Connection lost",
      storageError: "Reload recovery unavailable",
    })
    expect(button(html, "Send prompt")).toMatch(/\sdisabled(?:=|[ >])|aria-disabled="true"/)
    expect(html).toContain("Retry original")
    expect(html).toContain("Discard attempt")
    expect(html).toContain("original")
    expect(html).toContain("Connection lost")
    expect(html).toContain("Reload recovery unavailable")
  })

  it("shows conflict recovery beside the active composer without exposing image bytes or session IDs", () => {
    const html = renderInput({
      conflicts: [{ id: "other-draft", text: "preserved question", images: [image] }],
    })
    expect(html).toContain("Saved operator drafts")
    expect(html).toContain("Conflicting drafts were preserved")
    expect(html).toContain("Restore saved draft: preserved question")
    expect(html).toContain("1 images")
    expect(html).not.toContain(image.data)
  })

  it("shows fixed model capability and queued image counts", () => {
    const html = renderInput({
      imageInput: { ...DEFAULT_IMAGE_INPUT, supported: false },
      queuedInputs: 2,
      queuedImages: 3,
    })
    expect(button(html, "Attach images")).toMatch(/\sdisabled(?:=|[ >])|aria-disabled="true"/)
    expect(html).toContain("2 queued · 3 images")
    expect(html).toContain("fixture/vision")
  })

  it("restores multiline Tiptap content and clears acknowledgements without emitting draft edits", () => {
    const updates: string[] = []
    const editor = new Editor({
      element: null,
      extensions: [StarterKit],
      content: textDocument(""),
      onUpdate: ({ editor: updated }) => updates.push(updated.getText({ blockSeparator: "\n" })),
    })
    try {
      const saved = "<literal>\n\nlast line\n"
      synchronizePromptEditor(editor, saved, false)
      expect(editor.getText({ blockSeparator: "\n" })).toBe(saved)
      synchronizePromptEditor(editor, saved, false)
      expect(updates).toEqual([])
      editor.commands.insertContent({ type: "text", text: "edited" })
      expect(updates).toHaveLength(1)
      synchronizePromptEditor(editor, "", false)
      expect(updates).toHaveLength(1)
      expect(editor.getText({ blockSeparator: "\n" })).toBe("")
    } finally {
      editor.destroy()
    }
  })

  it("restores literal text without interpreting markup", () => {
    expect(textDocument("<img src=x onerror=alert(1)>\n&literal")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "<img src=x onerror=alert(1)>" }] },
        { type: "paragraph", content: [{ type: "text", text: "&literal" }] },
      ],
    })
  })
})

describe("bounded browser image input", () => {
  it("preserves decoded bytes without image processing", async () => {
    expect(
      new Uint8Array(await imageBlob({ mimeType: "image/png", data: "AAECA/7/" }).arrayBuffer()),
    ).toEqual(new Uint8Array([0, 1, 2, 3, 254, 255]))
  })

  it("rejects unsupported MIME and size before invoking browser image APIs", async () => {
    await expect(
      readDraftImage(new File(["gif"], "a.gif", { type: "image/gif" }), DEFAULT_IMAGE_INPUT),
    ).rejects.toThrow(/PNG, JPEG and WebP/)
    await expect(
      readDraftImage(new File(["1234"], "a.png", { type: "image/png" }), {
        ...DEFAULT_IMAGE_INPUT,
        maxImageBytes: 3,
      }),
    ).rejects.toThrow(/at most/)
    await expect(
      readDraftImage(new File(["x"], "a.png", { type: "image/png" }), {
        ...DEFAULT_IMAGE_INPUT,
        supported: false,
      }),
    ).rejects.toThrow(/does not support/)
  })

  it("rejects dimensions and base64 limits from metadata before native decoding", async () => {
    const header = new Uint8Array(33)
    header.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
    const view = new DataView(header.buffer)
    view.setUint32(16, 10000)
    view.setUint32(20, 10000)
    await expect(
      readDraftImage(new File([header], "huge.png", { type: "image/png" }), DEFAULT_IMAGE_INPUT),
    ).rejects.toThrow(/dimensions exceed/)
    view.setUint32(16, 1)
    view.setUint32(20, 1)
    await expect(
      readDraftImage(new File([header], "small.png", { type: "image/png" }), {
        ...DEFAULT_IMAGE_INPUT,
        maxBase64Bytes: 1,
      }),
    ).rejects.toThrow(/encoded image/)
  })

  it("rejects forged MIME, APNG and animated WebP", () => {
    expect(() => validateImageContainer(new TextEncoder().encode("not a png"), "image/png")).toThrow(
      /valid PNG/,
    )
    expect(() => validateImageContainer(new Uint8Array([255, 216, 255]), "image/jpeg")).not.toThrow()
    const apng = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 8, 97, 99, 84, 76, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ])
    expect(() => validateImageContainer(apng, "image/png")).toThrow(/Animated/)
    const webp = new Uint8Array([
      82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 88, 10, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ])
    expect(() => validateImageContainer(webp, "image/webp")).toThrow(/Animated/)
  })
})
