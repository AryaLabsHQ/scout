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
const LegacyStoredPromptSchema = Schema.Struct({
  version: Schema.Literal(1),
  draft: Schema.NullOr(PromptDraftSchema),
  pending: Schema.NullOr(PendingPromptSchema),
})
const StoredPromptSchema = Schema.Struct({
  version: Schema.Literal(2),
  draft: Schema.NullOr(PromptDraftSchema),
  pending: Schema.NullOr(PendingPromptSchema),
  conflicts: Schema.Array(PromptDraftSchema),
})
const SavedPromptSchema = Schema.Union([LegacyStoredPromptSchema, StoredPromptSchema])
export type PromptDraft = typeof PromptDraftSchema.Type
export type StoredPrompt = typeof SavedPromptSchema.Type
type CurrentStoredPrompt = typeof StoredPromptSchema.Type
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
    const request = factory.open(DATABASE, 2)
    let blocked = false
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
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
            request.result === undefined ? null : Schema.decodeUnknownSync(SavedPromptSchema)(request.result),
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

// IndexedDB serializes read/write transactions across connections (including other tabs).
// Read the latest record and compare identities inside that same transaction.
async function changePromptDraft(
  factory: IDBFactory | undefined,
  sessionId: string,
  change: (stored: CurrentStoredPrompt) => CurrentStoredPrompt,
): Promise<CurrentStoredPrompt> {
  const database = await openDatabase(factory)
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite")
      const store = transaction.objectStore(STORE)
      const request = store.get(sessionId)
      let result: CurrentStoredPrompt
      request.onsuccess = () => {
        try {
          const saved =
            request.result === undefined ? null : Schema.decodeUnknownSync(SavedPromptSchema)(request.result)
          if (saved?.pending && saved.pending.sessionId !== sessionId)
            throw new Error("Foreign session in saved prompt")
          result = change({
            version: 2,
            draft: saved?.draft ?? null,
            pending: saved?.pending ?? null,
            conflicts: saved?.version === 2 ? saved.conflicts : [],
          })
          store.put(result, sessionId)
        } catch (error) {
          transaction.abort()
          reject(error)
        }
      }
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = () => reject(transaction.error)
      transaction.onerror = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

function savedDrafts(stored: CurrentStoredPrompt): ReadonlyArray<PromptDraft> {
  return [...(stored.draft ? [stored.draft] : []), ...stored.conflicts]
}

function saveRevision(
  stored: CurrentStoredPrompt,
  draft: PromptDraft,
  replaces: string,
): CurrentStoredPrompt {
  return {
    ...stored,
    draft: draft.id === stored.pending?.draft.id ? null : draft,
    conflicts: savedDrafts(stored).filter(
      (other) =>
        other.id !== replaces &&
        other.id !== draft.id &&
        other.id !== stored.pending?.draft.id &&
        (other.text.length > 0 || other.images.length > 0),
    ),
  }
}

function releaseAttempt(stored: CurrentStoredPrompt, pending: PendingPrompt): CurrentStoredPrompt {
  if (stored.pending?.requestId !== pending.requestId) return stored
  const remaining = savedDrafts(stored).filter((draft) => draft.id !== pending.draft.id)
  return { version: 2, pending: null, draft: remaining[0] ?? emptyDraft(), conflicts: remaining.slice(1) }
}

function immutableDraft(draft: PromptDraft): PromptDraft {
  return Object.freeze({
    ...draft,
    images: Object.freeze(draft.images.map((image) => Object.freeze({ ...image }))),
  })
}
function immutablePending(pending: PendingPrompt | null): PendingPrompt | null {
  return pending ? Object.freeze({ ...pending, draft: immutableDraft(pending.draft) }) : null
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
  readonly conflicts: ReadonlyArray<PromptDraft>
  readonly ready: boolean
  readonly sending: boolean
  readonly error: string | null
  readonly storageError: string | null
}

const RECOVER_ATTEMPT =
  "An earlier submission has no local acknowledgement. Retry its original contents or discard the attempt before sending a new draft."
const STORAGE_FAILURE =
  "Browser storage failed. Your draft stays in memory, but reload recovery is unavailable; an older saved copy may remain."

export class PromptDraftController {
  private state: PromptDraftState = {
    draft: emptyDraft(),
    pending: null,
    conflicts: [],
    ready: false,
    sending: false,
    error: null,
    storageError: null,
  }
  private listeners = new Set<() => void>()
  private writes = Promise.resolve()
  private restoring: Promise<void> | undefined
  private unpersistedAttemptId: string | null = null
  private activityVersion = 0
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
  private observe(stored: CurrentStoredPrompt) {
    this.update({
      conflicts: savedDrafts(stored)
        .filter((draft) => draft.id !== this.state.draft.id && draft.id !== stored.pending?.draft.id)
        .map(immutableDraft),
    })
  }
  private persist(draft: PromptDraft, replaces: string) {
    if (!this.state.ready) return
    this.writes = this.writes.then(async () => {
      try {
        const saved = await changePromptDraft(this.factory, this.sessionId, (stored) =>
          saveRevision(stored, draft, replaces),
        )
        this.observe(saved)
        // A stale editor can discover an attempt, but can never clear one through saving.
        if (saved.pending && !this.state.pending)
          this.update({ pending: immutablePending(saved.pending), error: RECOVER_ATTEMPT })
        if (!this.unpersistedAttemptId) this.update({ storageError: null })
      } catch {
        this.update({ storageError: STORAGE_FAILURE })
      }
    })
  }
  flush = () => this.writes
  restore = (): Promise<void> => {
    if (this.restoring) return this.restoring
    const initialRevision = this.state.draft.id
    this.restoring = (async () => {
      try {
        const saved = await readPromptDraft(this.factory, this.sessionId)
        if (saved?.pending && saved.pending.sessionId !== this.sessionId)
          throw new Error("Foreign session in saved prompt")
        if (saved && !saved.draft && !saved.pending) throw new Error("Missing saved draft")
        const pending = saved?.pending
          ? Object.freeze({ ...saved.pending, draft: immutableDraft(saved.pending.draft) })
          : null
        this.update({
          ...(saved && this.state.draft.id === initialRevision
            ? { draft: saved.draft ? immutableDraft(saved.draft) : pending!.draft }
            : {}),
          pending,
          error: pending ? RECOVER_ATTEMPT : null,
          ready: true,
        })
        if (saved)
          this.observe({ ...saved, version: 2, conflicts: saved.version === 2 ? saved.conflicts : [] })
        if (
          this.state.draft.id !== initialRevision &&
          this.state.draft.id !== saved?.draft?.id &&
          this.state.draft.id !== pending?.draft.id
        )
          this.persist(this.state.draft, initialRevision)
      } catch {
        this.update({
          ready: true,
          storageError:
            "Browser storage could not be restored. Your draft stays in memory, but reload recovery is unavailable.",
        })
      }
    })()
    return this.restoring
  }
  refresh = async () => {
    if (!this.state.ready || this.state.sending) return
    const pending = this.state.pending
    const activity = this.activityVersion
    await this.flush()
    try {
      const saved = await readPromptDraft(this.factory, this.sessionId)
      if (saved?.pending && saved.pending.sessionId !== this.sessionId)
        throw new Error("Foreign session in saved prompt")
      if (this.state.sending || this.state.pending !== pending || this.activityVersion !== activity) return
      const stored: CurrentStoredPrompt = {
        version: 2,
        draft: saved?.draft ?? null,
        pending: saved?.pending ?? null,
        conflicts: saved?.version === 2 ? saved.conflicts : [],
      }
      this.observe(stored)
      if (!this.unpersistedAttemptId)
        this.update({
          pending: immutablePending(stored.pending),
          error: stored.pending ? RECOVER_ATTEMPT : null,
        })
    } catch {
      this.update({ storageError: STORAGE_FAILURE })
    }
  }
  edit = (text: string, images: ReadonlyArray<DraftImage>) => {
    if (text === this.state.draft.text && images === this.state.draft.images) return
    this.activityVersion++
    const previous = this.state.draft.id
    const draft = immutableDraft({ id: crypto.randomUUID(), text, images })
    this.update({ draft, error: this.state.pending ? this.state.error : null })
    this.persist(draft, previous)
  }
  recover = (draftId: string) => {
    const saved = this.state.conflicts.find((draft) => draft.id === draftId)
    if (!saved) return
    // Keep the visible edits as a separate recovery choice when swapping drafts.
    this.activityVersion++
    const previous = this.state.draft
    this.update({ draft: saved })
    this.persist(saved, saved.id)
    if (previous.text.length > 0 || previous.images.length > 0)
      this.update({ conflicts: [...this.state.conflicts.filter((draft) => draft.id !== saved.id), previous] })
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
    const reservation = this.reserve(pending, true)
    this.activityVersion++
    this.update({ pending, sending: true, error: null })
    await this.admit(pending, send, reservation)
  }
  retry = async (send: SubmitPrompt) => {
    if (!this.state.ready || this.state.sending || !this.state.pending) return
    const pending = this.state.pending
    const reservation = this.reserve(pending, false)
    this.activityVersion++
    this.update({ sending: true, error: null })
    await this.admit(pending, send, reservation)
  }
  private reserve(pending: PendingPrompt, create: boolean) {
    // Queue ownership before notifying editors, so reentrant edits cannot replace the
    // submitted revision before the transaction captures its immutable envelope.
    const reservation = this.writes.then(async () => {
      let saved: CurrentStoredPrompt | undefined
      try {
        saved = await changePromptDraft(this.factory, this.sessionId, (stored) => {
          if (stored.pending) return stored
          // A stale retry must not resurrect an acknowledged or discarded attempt.
          if (
            (!create || !savedDrafts(stored).some((draft) => draft.id === pending.draft.id)) &&
            this.unpersistedAttemptId !== pending.requestId
          )
            return stored
          return {
            ...stored,
            pending,
            draft: stored.draft?.id === pending.draft.id ? null : stored.draft,
            conflicts: stored.conflicts.filter((draft) => draft.id !== pending.draft.id),
          }
        })
        this.observe(saved)
        if (saved.pending?.requestId === pending.requestId) this.unpersistedAttemptId = null
        if (!this.unpersistedAttemptId) this.update({ storageError: null })
      } catch {
        this.unpersistedAttemptId = pending.requestId
        this.update({ storageError: STORAGE_FAILURE })
      }
      return saved
    })
    this.writes = reservation.then(() => {})
    return reservation
  }
  private async admit(
    pending: PendingPrompt,
    send: SubmitPrompt,
    reservation: Promise<CurrentStoredPrompt | undefined>,
  ) {
    try {
      const saved = await reservation
      if (saved && saved.pending?.requestId !== pending.requestId) {
        if (this.unpersistedAttemptId === pending.requestId) {
          this.update({
            error:
              "Another tab has an unresolved attempt. Your original attempt remains in memory; resolve the other tab before retrying here.",
          })
          return
        }
        this.update({
          pending: immutablePending(saved.pending),
          error: saved.pending
            ? RECOVER_ATTEMPT
            : "This attempt was already acknowledged or discarded in another view. Your edits are preserved; edit them before sending a new prompt.",
        })
        return
      }
      // Always send the captured immutable envelope, never the current editable revision.
      await send(payloadFor(pending))
      this.unpersistedAttemptId = null
      this.update({
        draft: this.state.draft.id === pending.draft.id ? emptyDraft() : this.state.draft,
        pending: null,
        error: null,
      })
      try {
        const released = await changePromptDraft(this.factory, this.sessionId, (stored) =>
          releaseAttempt(stored, pending),
        )
        this.observe(released)
        this.update({
          pending: immutablePending(released.pending),
          error: released.pending ? RECOVER_ATTEMPT : null,
        })
      } catch {
        this.update({ storageError: STORAGE_FAILURE })
      }
    } catch (error) {
      this.update({
        error: `Submission was not acknowledged. ${error instanceof Error ? error.message : "The hub rejected the request or the connection failed."} Retry sends the original text and images unchanged.`,
      })
    } finally {
      this.update({ sending: false })
      await this.flush()
    }
  }
  discard = () => {
    if (this.state.sending || !this.state.pending) return
    const pending = this.state.pending
    this.activityVersion++
    this.unpersistedAttemptId = null
    this.update({
      draft: this.state.draft.id === pending.draft.id ? emptyDraft() : this.state.draft,
      pending: null,
      error: null,
    })
    this.writes = this.writes.then(async () => {
      try {
        const saved = await changePromptDraft(this.factory, this.sessionId, (stored) =>
          releaseAttempt(stored, pending),
        )
        this.observe(saved)
        if (!this.state.pending)
          this.update({
            pending: immutablePending(saved.pending),
            error: saved.pending ? RECOVER_ATTEMPT : null,
          })
      } catch {
        this.update({ storageError: STORAGE_FAILURE })
      }
    })
  }
}
