import { Schema } from "effect"
import type { OperatorImageInput, OperatorPromptParams } from "@scout/shared"
import { validatePrompt, type DraftImage } from "./operator-image-input"

const DraftImageSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  data: Schema.String,
  byteLength: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
})
const PromptDraftSchema = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  images: Schema.Array(DraftImageSchema),
})
const PendingPromptSchema = Schema.Struct({
  sessionId: Schema.String,
  requestId: Schema.String,
  draft: PromptDraftSchema,
})
const StoredPromptSchema = Schema.Struct({
  version: Schema.Literal(1),
  draft: Schema.NullOr(PromptDraftSchema),
  pending: Schema.NullOr(PendingPromptSchema),
})
export type PromptDraft = typeof PromptDraftSchema.Type
export type StoredPrompt = typeof StoredPromptSchema.Type
export type PendingPrompt = typeof PendingPromptSchema.Type
export type SubmitPrompt = (payload: OperatorPromptParams) => Promise<unknown>

const DATABASE = "scout:operator:prompt-drafts"
const STORE = "sessions"

function openDatabase(factory: IDBFactory | undefined): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!factory) {
      reject(new Error("IndexedDB is unavailable"))
      return
    }
    const request = factory.open(DATABASE, 1)
    let blocked = false
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      blocked = true
      reject(new Error("IndexedDB upgrade blocked"))
    }
    request.onsuccess = () => {
      if (blocked) {
        request.result.close()
        return
      }
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}

export async function readPromptDraft(
  factory: IDBFactory | undefined,
  sessionId: string,
): Promise<StoredPrompt | null> {
  const database = await openDatabase(factory)
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly")
      const request = transaction.objectStore(STORE).get(sessionId)
      transaction.oncomplete = () => {
        try {
          resolve(
            request.result === undefined
              ? null
              : Schema.decodeUnknownSync(StoredPromptSchema)(request.result),
          )
        } catch (error) {
          reject(error)
        }
      }
      transaction.onabort = () => reject(transaction.error)
      transaction.onerror = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

export async function writePromptDraft(
  factory: IDBFactory | undefined,
  sessionId: string,
  value: StoredPrompt,
): Promise<void> {
  const database = await openDatabase(factory)
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite")
      transaction.objectStore(STORE).put(value, sessionId)
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
      transaction.onerror = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

function immutableDraft(draft: PromptDraft): PromptDraft {
  return Object.freeze({
    ...draft,
    images: Object.freeze(draft.images.map((image) => Object.freeze({ ...image }))),
  })
}
function emptyDraft(): PromptDraft {
  return immutableDraft({ id: crypto.randomUUID(), text: "", images: [] })
}
function payloadFor(pending: PendingPrompt): OperatorPromptParams {
  return {
    sessionId: pending.sessionId,
    requestId: pending.requestId,
    text: pending.draft.text,
    ...(pending.draft.images.length
      ? { images: pending.draft.images.map(({ mimeType, data }) => ({ mimeType, data })) }
      : {}),
  }
}

interface PromptDraftState {
  readonly draft: PromptDraft
  readonly pending: PendingPrompt | null
  readonly ready: boolean
  readonly sending: boolean
  readonly error: string | null
  readonly storageError: string | null
}

export class PromptDraftController {
  private state: PromptDraftState = {
    draft: emptyDraft(),
    pending: null,
    ready: false,
    sending: false,
    error: null,
    storageError: null,
  }
  private listeners = new Set<() => void>()
  private writes = Promise.resolve()
  private persistenceVersion = 0
  private restoring: Promise<void> | undefined
  constructor(
    readonly sessionId: string,
    private readonly factory: IDBFactory | undefined,
  ) {}
  getSnapshot = (): PromptDraftState => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private update(patch: Partial<PromptDraftState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
  private persist() {
    if (!this.state.ready) return
    const { draft, pending } = this.state
    const version = ++this.persistenceVersion
    // A submitted revision lives in the pending attempt only, rather than storing its bytes twice.
    const stored: StoredPrompt = { version: 1, draft: draft.id === pending?.draft.id ? null : draft, pending }
    this.writes = this.writes.then(async () => {
      try {
        await writePromptDraft(this.factory, this.sessionId, stored)
        if (version === this.persistenceVersion && this.state.storageError)
          this.update({ storageError: null })
      } catch {
        this.update({
          storageError:
            "Browser storage failed. Your draft stays in memory, but reload recovery is unavailable; an older saved copy may remain.",
        })
      }
    })
  }
  flush = () => this.writes
  restore = (): Promise<void> => {
    if (this.restoring) return this.restoring
    const initialRevision = this.state.draft.id
    this.restoring = (async () => {
      try {
        const stored = await readPromptDraft(this.factory, this.sessionId)
        const pending = stored?.pending
          ? Object.freeze({ ...stored.pending, draft: immutableDraft(stored.pending.draft) })
          : null
        if (stored?.pending && stored.pending.sessionId !== this.sessionId)
          throw new Error("Foreign session in saved prompt")
        if (stored && !stored.draft && !stored.pending) throw new Error("Missing saved draft")
        this.update({
          ...(stored && this.state.draft.id === initialRevision
            ? { draft: stored.draft ? immutableDraft(stored.draft) : pending!.draft }
            : {}),
          pending,
          error: stored?.pending
            ? "An earlier submission has no local acknowledgement. Retry its original contents or discard the attempt before sending a new draft."
            : null,
          ready: true,
        })
      } catch {
        this.update({
          ready: true,
          storageError:
            "Browser storage could not be restored. Your draft stays in memory, but reload recovery is unavailable.",
        })
      }
      if (this.state.draft.id !== initialRevision) this.persist()
    })()
    return this.restoring
  }
  edit = (text: string, images: ReadonlyArray<DraftImage>) => {
    if (text === this.state.draft.text && images === this.state.draft.images) return
    this.update({
      draft: immutableDraft({ id: crypto.randomUUID(), text, images }),
      error: this.state.pending ? this.state.error : null,
    })
    this.persist()
  }
  setError = (error: string | null) => {
    this.update({ error })
  }
  submit = async (limits: OperatorImageInput, send: SubmitPrompt) => {
    if (!this.state.ready || this.state.sending || this.state.pending) return
    const pending: PendingPrompt = Object.freeze({
      sessionId: this.sessionId,
      requestId: crypto.randomUUID(),
      draft: this.state.draft,
    })
    const error = validatePrompt(payloadFor(pending), pending.draft.images, limits)
    if (error) {
      this.update({ error })
      return
    }
    this.update({ pending })
    await this.admit(pending, send)
  }
  retry = async (send: SubmitPrompt) => {
    if (!this.state.ready || this.state.sending || !this.state.pending) return
    await this.admit(this.state.pending, send)
  }
  private async admit(pending: PendingPrompt, send: SubmitPrompt) {
    this.update({ sending: true, error: null })
    this.persist()
    await this.flush()
    try {
      await send(payloadFor(pending))
      this.update({
        pending: null,
        draft: this.state.draft.id === pending.draft.id ? emptyDraft() : this.state.draft,
        error: null,
      })
    } catch (error) {
      this.update({
        error: `Submission was not acknowledged. ${error instanceof Error ? error.message : "The hub rejected the request or the connection failed."} Retry sends the original text and images unchanged.`,
      })
    } finally {
      this.update({ sending: false })
      this.persist()
      await this.flush()
    }
  }
  discard = () => {
    if (this.state.sending) return
    this.update({
      draft: this.state.draft.id === this.state.pending?.draft.id ? emptyDraft() : this.state.draft,
      pending: null,
      error: null,
    })
    this.persist()
  }
}
