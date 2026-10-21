import { describe, expect, it, vi } from "vitest"
import { IDBFactory, IDBObjectStore } from "fake-indexeddb"
import {
  PromptDraftController,
  readPromptDraft,
  writePromptDraft,
  type PromptDraft,
} from "../src/components/operator/operator-prompt-drafts"
import { DEFAULT_IMAGE_INPUT, validatePrompt } from "../src/components/operator/operator-image-input"

const image = {
  id: "image-a",
  name: "a.png",
  mimeType: "image/png",
  data: "AQID",
  byteLength: 3,
  width: 1,
  height: 1,
}
const draft: PromptDraft = { id: "revision-a", text: "inspect", images: [image] }
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function controller(sessionId = "session-a", database = new IDBFactory()) {
  const value = new PromptDraftController(sessionId, database)
  await value.restore()
  return { value, database }
}

describe("recoverable operator admission", () => {
  it("keeps the immutable original bytes and request ID after an uncertain response", async () => {
    const { value } = await controller()
    value.edit("inspect", [image])
    let first: unknown
    await value.submit(DEFAULT_IMAGE_INPUT, async (payload) => {
      first = payload
      throw new Error("connection lost")
    })
    value.edit("new question", [{ ...image, id: "image-b", data: "BAUG" }])
    let retried: unknown
    await value.retry(async (payload) => {
      retried = payload
    })
    expect(retried).toEqual(first)
    expect(value.getSnapshot().draft.text).toBe("new question")
    expect(value.getSnapshot().draft.images[0]?.data).toBe("BAUG")
    expect(value.getSnapshot().pending).toBeNull()
  })

  it("clears only the acknowledged revision, even if the user edits back to the same text", async () => {
    const { value } = await controller()
    value.edit("inspect", [image])
    const admission = deferred<void>()
    const sent = value.submit(DEFAULT_IMAGE_INPUT, () => admission.promise)
    value.edit("changed", [image])
    value.edit("inspect", [image])
    admission.resolve()
    await sent
    expect(value.getSnapshot().draft.text).toBe("inspect")
    expect(value.getSnapshot().draft.images).toEqual([image])
  })

  it("saves pending admission before invoking RPC and reloads it without duplicate payload copies", async () => {
    const { value, database } = await controller()
    value.edit("inspect", [image])
    await value.submit(DEFAULT_IMAGE_INPUT, async () => {
      const saved = await readPromptDraft(database, "session-a")
      expect(saved?.draft).toBeNull()
      expect(saved?.pending?.draft.images).toEqual([image])
      throw new Error("no acknowledgement")
    })
    const restored = new PromptDraftController("session-a", database)
    await restored.restore()
    expect(restored.getSnapshot().draft.images).toEqual([image])
    expect(restored.getSnapshot().pending?.requestId).toBe(value.getSnapshot().pending?.requestId)
    await restored.retry(async () => {})
    const saved = await readPromptDraft(database, "session-a")
    expect(saved?.pending).toBeNull()
    expect(saved?.draft?.images).toEqual([])
  })

  it("reloads unsubmitted text and ordered images, isolated by session", async () => {
    const { value, database } = await controller()
    value.edit("a\n<b>", [image, { ...image, id: "b", data: "BAUG" }])
    await value.flush()
    const restored = new PromptDraftController("session-a", database)
    await restored.restore()
    expect(restored.getSnapshot().draft).toEqual(value.getSnapshot().draft)
    const other = new PromptDraftController("session-b", database)
    await other.restore()
    expect(other.getSnapshot().draft.text).toBe("")
    expect(other.getSnapshot().pending).toBeNull()
  })

  it("does not overwrite edits made during restoration", async () => {
    const database = new IDBFactory()
    await writePromptDraft(database, "session-a", { version: 1, draft, pending: null })
    const value = new PromptDraftController("session-a", database)
    const restoring = value.restore()
    value.edit("typed during load", [])
    await restoring
    expect(value.getSnapshot().draft.text).toBe("typed during load")
    await value.flush()
    expect((await readPromptDraft(database, "session-a"))?.draft?.text).toBe("typed during load")
  })

  it("keeps memory and exposes storage failure without pretending reload recovery works", async () => {
    const value = new PromptDraftController("session-a", undefined)
    await value.restore()
    value.edit("keep me", [image])
    await value.submit(DEFAULT_IMAGE_INPUT, async () => {
      throw new Error("offline")
    })
    expect(value.getSnapshot().storageError).toMatch(/reload/i)
    expect(value.getSnapshot().draft.text).toBe("keep me")
    expect(value.getSnapshot().pending).not.toBeNull()
  })

  it("keeps the latest draft and pending bytes when IndexedDB writes fail", async () => {
    const { value } = await controller()
    const failingWrite = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError")
    })
    try {
      value.edit("do not lose", [image])
      await value.submit(DEFAULT_IMAGE_INPUT, async () => {
        throw new Error("offline")
      })
      expect(value.getSnapshot().draft.images).toEqual([image])
      expect(value.getSnapshot().pending?.draft.text).toBe("do not lose")
      expect(value.getSnapshot().storageError).toMatch(/older saved copy/)
    } finally {
      failingWrite.mockRestore()
    }
  })

  it("does not clear another session when the first admission resolves late", async () => {
    const { value: first, database } = await controller("first")
    const { value: second } = await controller("second", database)
    first.edit("first prompt", [image])
    const admission = deferred<void>()
    const sending = first.submit(DEFAULT_IMAGE_INPUT, () => admission.promise)
    second.edit("second prompt", [{ ...image, id: "second" }])
    await second.flush()
    admission.resolve()
    await sending
    expect(second.getSnapshot().draft.text).toBe("second prompt")
    expect((await readPromptDraft(database, "second"))?.draft?.images[0]?.id).toBe("second")
    expect((await readPromptDraft(database, "first"))?.pending).toBeNull()
  })

  it("blocks a second concurrent call and freezes submitted draft contents", async () => {
    const { value } = await controller()
    value.edit("first", [image])
    const admission = deferred<void>()
    let calls = 0
    const sending = value.submit(DEFAULT_IMAGE_INPUT, async () => {
      calls++
      await admission.promise
    })
    await value.submit(DEFAULT_IMAGE_INPUT, async () => {
      calls++
    })
    await value.retry(async () => {
      calls++
    })
    expect(Object.isFrozen(value.getSnapshot().pending?.draft)).toBe(true)
    expect(Object.isFrozen(value.getSnapshot().pending?.draft.images)).toBe(true)
    admission.resolve()
    await sending
    expect(calls).toBe(1)
  })

  it("blocks overlapping sends; discard retains newer edits and a new send gets a new ID", async () => {
    const { value } = await controller()
    value.edit("first", [])
    let original: string | undefined
    await value.submit(DEFAULT_IMAGE_INPUT, async (payload) => {
      original = payload.requestId
      throw new Error("offline")
    })
    value.edit("second", [])
    let calls = 0
    await value.submit(DEFAULT_IMAGE_INPUT, async () => {
      calls++
    })
    expect(calls).toBe(0)
    value.discard()
    expect(value.getSnapshot().draft.text).toBe("second")
    await value.submit(DEFAULT_IMAGE_INPUT, async (payload) => {
      expect(payload.requestId).not.toBe(original)
    })
    expect(value.getSnapshot().draft.text).toBe("")
  })

  it("rejects corrupt storage rather than accepting a foreign session envelope", async () => {
    const database = new IDBFactory()
    await writePromptDraft(database, "session-a", {
      version: 1,
      draft: null,
      pending: { sessionId: "foreign", requestId: "r", draft },
    })
    const value = new PromptDraftController("session-a", database)
    await value.restore()
    expect(value.getSnapshot().pending).toBeNull()
    expect(value.getSnapshot().storageError).toMatch(/reload/i)
  })
})

describe("browser prompt limits", () => {
  it("admits text-only, image-only and mixed input", () => {
    expect(validatePrompt({ sessionId: "s", text: "text" }, [], DEFAULT_IMAGE_INPUT)).toBeNull()
    expect(
      validatePrompt({ sessionId: "s", text: "", images: [image] }, [image], DEFAULT_IMAGE_INPUT),
    ).toBeNull()
    expect(
      validatePrompt({ sessionId: "s", text: "text", images: [image] }, [image], DEFAULT_IMAGE_INPUT),
    ).toBeNull()
    expect(validatePrompt({ sessionId: "s", text: " " }, [], DEFAULT_IMAGE_INPUT)).toMatch(/text|image/i)
  })

  it("enforces supplied capability, count, bytes, dimensions, pixels, base64 and serialized UTF-8 limits", () => {
    const payload = { sessionId: "s", text: "🦉", images: [image] }
    for (const limits of [
      { supported: false },
      { maxImages: 0 },
      { maxImageBytes: 2 },
      { maxTotalImageBytes: 2 },
      { maxPixels: 0 },
      { maxWidth: 0 },
      { maxHeight: 0 },
      { maxBase64Bytes: 3 },
      { maxSerializedBytes: 1 },
    ]) {
      expect(validatePrompt(payload, [image], { ...DEFAULT_IMAGE_INPUT, ...limits })).not.toBeNull()
    }
  })
})
