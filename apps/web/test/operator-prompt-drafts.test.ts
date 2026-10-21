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
  it("sends a failed edit-save after storage recovers without another edit and retries exact bytes", async () => {
    const { value, database } = await controller()
    const images = [image, { ...image, id: "b", data: "BAUG" }]
    const failingWrite = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError")
    })
    try {
      value.edit("retained draft", images)
      await value.flush()
      expect(value.getSnapshot().storageError).not.toBeNull()
    } finally {
      failingWrite.mockRestore()
    }
    const sent: unknown[] = []
    let edited = false
    const unsubscribe = value.subscribe(() => {
      if (!edited && value.getSnapshot().sending) {
        edited = true
        value.edit("newer pending edit", [])
      }
    })
    await value.submit(DEFAULT_IMAGE_INPUT, async (payload) => {
      sent.push(payload)
      expect((await readPromptDraft(database, "session-a"))?.pending?.requestId).toBe(payload.requestId)
      throw new Error("lost acknowledgement")
    })
    unsubscribe()
    expect(sent).toEqual([
      {
        sessionId: "session-a",
        requestId: expect.any(String),
        text: "retained draft",
        images: images.map(({ mimeType, data }) => ({ mimeType, data })),
      },
    ])
    await value.retry(async (payload) => {
      sent.push(payload)
    })
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(value.getSnapshot().draft.text).toBe("newer pending edit")
    expect(value.getSnapshot().pending).toBeNull()
  })

  it.each(["acknowledge", "discard"])(
    "retains a failed local revision behind a foreign pending attempt until %s",
    async (resolution) => {
      const { value: local, database } = await controller()
      const { value: foreign } = await controller("session-a", database)
      const failingWrite = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError")
      })
      try {
        local.edit("retained local", [image])
        await local.flush()
      } finally {
        failingWrite.mockRestore()
      }
      foreign.edit("foreign", [{ ...image, data: "BAUG" }])
      await foreign.submit(DEFAULT_IMAGE_INPUT, async () => {
        throw new Error("offline")
      })
      const pending = foreign.getSnapshot().pending
      let calls = 0
      await local.submit(DEFAULT_IMAGE_INPUT, async () => {
        calls++
      })
      expect(calls).toBe(0)
      expect((await readPromptDraft(database, "session-a"))?.pending).toEqual(pending)
      expect(local.getSnapshot().draft.text).toBe("retained local")
      if (resolution === "acknowledge") await foreign.retry(async () => {})
      else {
        foreign.discard()
        await foreign.flush()
      }
      await local.refresh()
      await local.submit(DEFAULT_IMAGE_INPUT, async (payload) => {
        calls++
        expect(payload.text).toBe("retained local")
        expect(payload.images).toEqual([{ mimeType: image.mimeType, data: image.data }])
        expect(payload.requestId).not.toBe(pending?.requestId)
      })
      expect(calls).toBe(1)
    },
  )

  it("does not treat a failed save of a recovered remote revision as a new local edit", async () => {
    const database = new IDBFactory()
    const other = { ...draft, id: "revision-b", text: "other" }
    await writePromptDraft(database, "session-a", {
      version: 2,
      draft: other,
      pending: null,
      conflicts: [draft],
    })
    const { value: stale } = await controller("session-a", database)
    const { value: owner } = await controller("session-a", database)
    const failingWrite = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError")
    })
    try {
      stale.recover(draft.id)
      await stale.flush()
    } finally {
      failingWrite.mockRestore()
    }
    owner.recover(draft.id)
    await owner.submit(DEFAULT_IMAGE_INPUT, async () => {})
    let calls = 0
    await stale.submit(DEFAULT_IMAGE_INPUT, async () => {
      calls++
    })
    expect(calls).toBe(0)
    expect((await readPromptDraft(database, "session-a"))?.pending).toBeNull()
  })

  it.each(["acknowledge", "discard"])(
    "does not reserve a saved revision settled by another controller via %s",
    async (resolution) => {
      const database = new IDBFactory()
      await writePromptDraft(database, "session-a", { version: 1, draft, pending: null })
      const { value: stale } = await controller("session-a", database)
      const { value: owner } = await controller("session-a", database)
      await owner.submit(DEFAULT_IMAGE_INPUT, async () => {
        if (resolution === "discard") throw new Error("offline")
      })
      if (resolution === "discard") {
        owner.discard()
        await owner.flush()
      }
      let calls = 0
      await stale.submit(DEFAULT_IMAGE_INPUT, async () => {
        calls++
      })
      expect(calls).toBe(0)
      expect(stale.getSnapshot().pending).toBeNull()
      expect((await readPromptDraft(database, "session-a"))?.pending).toBeNull()
    },
  )

  it("preserves another restored controller's uncertain attempt when saving newer edits", async () => {
    const { value: first, database } = await controller()
    const { value: second } = await controller("session-a", database)
    first.edit("original A", [image])
    let original: unknown
    await first.submit(DEFAULT_IMAGE_INPUT, async (payload) => {
      original = payload
      throw new Error("lost acknowledgement")
    })
    second.edit("independent B", [{ ...image, id: "b", data: "BAUG" }])
    await second.flush()
    const restored = new PromptDraftController("session-a", database)
    await restored.restore()
    expect(restored.getSnapshot().pending?.draft.text).toBe("original A")
    expect(restored.getSnapshot().draft.text).toBe("independent B")
    let retried: unknown
    await restored.retry(async (payload) => {
      retried = payload
    })
    expect(retried).toEqual(original)
    expect(restored.getSnapshot().draft.images[0]?.data).toBe("BAUG")
  })

  it("atomically chooses one attempt across controllers restored before either sends", async () => {
    const { value: first, database } = await controller()
    const { value: second } = await controller("session-a", database)
    first.edit("A", [image])
    second.edit("B", [{ ...image, id: "b", data: "BAUG" }])
    let calls = 0
    await Promise.all(
      [first, second].map((value) =>
        value.submit(DEFAULT_IMAGE_INPUT, async () => {
          calls++
          throw new Error("lost acknowledgement")
        }),
      ),
    )
    expect(calls).toBe(1)
    const saved = await readPromptDraft(database, "session-a")
    expect(saved?.pending).not.toBeNull()
    const restored = new PromptDraftController("session-a", database)
    await restored.restore()
    expect([restored.getSnapshot().draft.text, restored.getSnapshot().pending?.draft.text].sort()).toEqual([
      "A",
      "B",
    ])
  })

  it("a delayed acknowledgement cannot clear a replacement attempt from another controller", async () => {
    const { value: first, database } = await controller()
    first.edit("A", [image])
    const started = deferred<void>()
    const admission = deferred<void>()
    const sending = first.submit(DEFAULT_IMAGE_INPUT, async () => {
      started.resolve()
      await admission.promise
    })
    await started.promise
    const { value: second } = await controller("session-a", database)
    second.discard()
    second.edit("B", [{ ...image, id: "b", data: "BAUG" }])
    await second.submit(DEFAULT_IMAGE_INPUT, async () => {
      throw new Error("offline")
    })
    const replacement = second.getSnapshot().pending
    admission.resolve()
    await sending
    expect((await readPromptDraft(database, "session-a"))?.pending).toEqual(replacement)
  })

  it("preserves both independently edited drafts and lets recovery swap them without losing bytes", async () => {
    const database = new IDBFactory()
    await writePromptDraft(database, "session-a", { version: 1, draft, pending: null })
    const { value: first } = await controller("session-a", database)
    const { value: second } = await controller("session-a", database)
    first.edit("A", [image])
    second.edit("B", [{ ...image, id: "b", data: "BAUG" }])
    await Promise.all([first.flush(), second.flush()])
    const { value: restored } = await controller("session-a", database)
    const before = restored.getSnapshot()
    expect([before.draft.text, ...before.conflicts.map((other) => other.text)].sort()).toEqual(["A", "B"])
    const conflict = before.conflicts[0]!
    restored.recover(conflict.id)
    await restored.flush()
    const { value: reloaded } = await controller("session-a", database)
    expect(reloaded.getSnapshot().draft).toEqual(conflict)
    expect(reloaded.getSnapshot().conflicts).toEqual([before.draft])
  })

  it("sends only one new ID for the same saved draft restored in two controllers, without notifications", async () => {
    const database = new IDBFactory()
    await writePromptDraft(database, "session-a", { version: 1, draft, pending: null })
    const { value: first } = await controller("session-a", database)
    const { value: second } = await controller("session-a", database)
    const admission = deferred<void>()
    const started = deferred<void>()
    const sent: string[] = []
    const send = async (payload: { requestId?: string }) => {
      sent.push(payload.requestId!)
      started.resolve()
      await admission.promise
    }
    const firstSending = first.submit(DEFAULT_IMAGE_INPUT, send)
    const secondSending = second.submit(DEFAULT_IMAGE_INPUT, send)
    await started.promise
    expect(sent).toHaveLength(1)
    admission.resolve()
    await Promise.all([firstSending, secondSending])
    expect(sent).toHaveLength(1)
    // A stale retry must also consult IndexedDB after the winner acknowledged.
    await second.retry(async () => {
      throw new Error("must not resend settled draft")
    })
    expect(second.getSnapshot().pending).toBeNull()
    expect((await readPromptDraft(database, "session-a"))?.pending).toBeNull()
  })

  it("a stale discard cannot clear another tab's newer pending envelope", async () => {
    const { value: first, database } = await controller()
    first.edit("A", [image])
    await first.submit(DEFAULT_IMAGE_INPUT, async () => {
      throw new Error("offline")
    })
    const { value: stale } = await controller("session-a", database)
    const { value: second } = await controller("session-a", database)
    second.discard()
    second.edit("B", [{ ...image, data: "BAUG" }])
    await second.submit(DEFAULT_IMAGE_INPUT, async () => {
      throw new Error("offline")
    })
    const replacement = second.getSnapshot().pending
    stale.discard()
    await stale.flush()
    expect((await readPromptDraft(database, "session-a"))?.pending).toEqual(replacement)
    expect(stale.getSnapshot().pending).toEqual(replacement)
    let payload: unknown
    await stale.retry(async (sent) => {
      payload = sent
    })
    expect(payload).toMatchObject({
      requestId: replacement?.requestId,
      text: "B",
      images: [{ data: "BAUG" }],
    })
  })

  it("retries the same in-memory envelope after storage recovers and retains newer saved edits", async () => {
    const { value, database } = await controller()
    const failingWrite = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError")
    })
    let original: unknown
    try {
      value.edit("A", [image])
      await value.submit(DEFAULT_IMAGE_INPUT, async (payload) => {
        original = payload
        throw new Error("offline")
      })
    } finally {
      failingWrite.mockRestore()
    }
    value.edit("B", [{ ...image, data: "BAUG" }])
    await value.flush()
    expect(value.getSnapshot().storageError).not.toBeNull()
    let retried: unknown
    await value.retry(async (payload) => {
      retried = payload
    })
    expect(retried).toEqual(original)
    const { value: restored } = await controller("session-a", database)
    expect(restored.getSnapshot().draft.text).toBe("B")
    expect(restored.getSnapshot().draft.images[0]?.data).toBe("BAUG")
    expect(restored.getSnapshot().pending).toBeNull()
  })

  it("upgrades an actual version-one database and retains a legacy pending key and image bytes", async () => {
    const database = new IDBFactory()
    await new Promise<void>((resolve, reject) => {
      const open = database.open("scout:operator:prompt-drafts", 1)
      open.onupgradeneeded = () => open.result.createObjectStore("sessions")
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const transaction = open.result.transaction("sessions", "readwrite")
        transaction
          .objectStore("sessions")
          .put(
            { version: 1, draft: null, pending: { sessionId: "session-a", requestId: "legacy-key", draft } },
            "session-a",
          )
        transaction.oncomplete = () => {
          open.result.close()
          resolve()
        }
        transaction.onerror = () => reject(transaction.error)
      }
    })
    const { value } = await controller("session-a", database)
    value.edit("new B", [{ ...image, data: "BAUG" }])
    let retried: unknown
    await value.retry(async (payload) => {
      retried = payload
    })
    expect(retried).toEqual({
      sessionId: "session-a",
      requestId: "legacy-key",
      text: draft.text,
      images: [{ mimeType: image.mimeType, data: image.data }],
    })
    const { value: restored } = await controller("session-a", database)
    expect(restored.getSnapshot().draft.text).toBe("new B")
    expect((await readPromptDraft(database, "session-a"))?.version).toBe(2)
  })

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
    let calls = 0
    const sent = value.submit(DEFAULT_IMAGE_INPUT, () => {
      calls++
      return admission.promise
    })
    value.edit("changed", [image])
    value.edit("inspect", [image])
    admission.resolve()
    await sent
    expect(calls).toBe(1)
    expect(value.getSnapshot().draft.text).toBe("inspect")
    expect(value.getSnapshot().draft.images).toEqual([image])
  })

  it("reserves the submitted revision before notifying views that may edit the composer", async () => {
    const { value, database } = await controller()
    value.edit("original", [image])
    let edited = false
    const unsubscribe = value.subscribe(() => {
      if (!edited && value.getSnapshot().sending) {
        edited = true
        value.edit("newer edit", [{ ...image, data: "BAUG" }])
      }
    })
    let calls = 0
    await value.submit(DEFAULT_IMAGE_INPUT, async (payload) => {
      calls++
      expect(payload.text).toBe("original")
      expect(payload.images?.[0]?.data).toBe(image.data)
    })
    unsubscribe()
    expect(calls).toBe(1)
    const { value: restored } = await controller("session-a", database)
    expect(restored.getSnapshot().draft.text).toBe("newer edit")
    expect(restored.getSnapshot().draft.images[0]?.data).toBe("BAUG")
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
