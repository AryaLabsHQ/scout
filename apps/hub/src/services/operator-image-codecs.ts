import { Worker } from "node:worker_threads"
import { Context, Effect, Layer, Schema } from "effect"
import { ManagementError, OPERATOR_IMAGE_LIMITS, type OperatorImageMetadata } from "@scout/shared"
import {
  OPERATOR_IMAGE_DECODE_TIMEOUT_MS,
  OperatorImageDecodeResponse,
} from "./operator-image-codec-protocol.js"

const unavailable = (message: string) => new ManagementError({ code: "operator-input-busy", message })

const make = Effect.gen(function* () {
  let closed = false
  let worker: Worker | undefined
  let stopping: Promise<void> | undefined
  let pending: { complete: (error?: Error) => void } | undefined

  const stop = (error: Error) => {
    const current = worker
    worker = undefined
    pending?.complete(error)
    if (current !== undefined) {
      stopping = current.terminate().then(() => {
        stopping = undefined
      })
    }
    return stopping ?? Promise.resolve()
  }

  yield* Effect.addFinalizer(() => {
    closed = true
    return Effect.promise(() => stop(unavailable("Image decoder is shutting down")))
  })

  return {
    /** A single worker, no waiting jobs; saturation fails before copying compressed bytes. */
    decode: async (bytes: Buffer, metadata: OperatorImageMetadata, signal?: AbortSignal) => {
      if (closed) throw unavailable("Image decoder is closed")
      if (pending !== undefined || stopping !== undefined)
        throw unavailable("Image decoder is busy; retry this submission")
      if (signal?.aborted) throw unavailable("Image decoding was cancelled; retry this submission")
      if (
        bytes.byteLength > OPERATOR_IMAGE_LIMITS.maxImageBytes ||
        metadata.width <= 0 ||
        metadata.height <= 0 ||
        metadata.width * metadata.height > OPERATOR_IMAGE_LIMITS.maxPixels
      )
        throw new Error("Image exceeds codec limits")

      if (worker === undefined) {
        // Compile with this worker entrypoint and --entry-naming '[name].[ext]' so its URL is stable.
        const current = new Worker(new URL("./operator-image-codec-worker.js", import.meta.url))
        worker = current
        current.on("message", (message: unknown) => {
          if (worker !== current) return
          try {
            const response = Schema.decodeUnknownSync(OperatorImageDecodeResponse)(message)
            if (response.status === "done") {
              pending?.complete(response.valid ? undefined : new Error("Invalid image pixels"))
            }
          } catch {
            void stop(new Error("Invalid image decoder response"))
          }
        })
        current.on("error", (cause: Error) => {
          if (worker === current) void stop(new Error("Image decoder worker failed", { cause }))
        })
        current.on("exit", () => {
          if (worker !== current) return
          worker = undefined
          pending?.complete(new Error("Image decoder worker exited"))
        })
      }
      const current = worker
      return new Promise<void>((resolve, reject) => {
        const abort = () => {
          void stop(unavailable("Image decoding was cancelled; retry this submission"))
        }
        const timer = setTimeout(() => {
          void stop(unavailable("Image decoding timed out; retry this submission"))
        }, OPERATOR_IMAGE_DECODE_TIMEOUT_MS)
        pending = {
          complete: (error) => {
            clearTimeout(timer)
            signal?.removeEventListener("abort", abort)
            pending = undefined
            if (error === undefined) resolve()
            else reject(error)
          },
        }
        signal?.addEventListener("abort", abort, { once: true })
        try {
          // Buffer views can retain larger backing stores; transfer only a bounded owned copy.
          const input = Uint8Array.from(bytes)
          current.postMessage({ bytes: input, metadata }, [input.buffer])
        } catch {
          void stop(new Error("Could not submit image to decoder"))
        }
      })
    },
  }
})

export class OperatorImageCodecs extends Context.Service<OperatorImageCodecs, Effect.Success<typeof make>>()(
  "@scout/OperatorImageCodecs",
  { make },
) {
  static readonly layer = Layer.effect(this, this.make)
}
