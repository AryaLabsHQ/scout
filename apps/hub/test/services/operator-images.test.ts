import { Worker } from "node:worker_threads"
import { deflateSync } from "node:zlib"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { OPERATOR_IMAGE_LIMITS } from "@scout/shared"
import { Effect, Exit, Scope } from "effect"
import { OperatorImageCodecs } from "../../src/services/operator-image-codecs.js"
import { OPERATOR_IMAGE_DECODE_TIMEOUT_MS } from "../../src/services/operator-image-codec-protocol.js"
import {
  imageInputFor,
  imageMetadata,
  validateOperatorInput as validate,
} from "../../src/services/operator-images.js"

import {
  corruptCompressedImages,
  png,
  jpeg,
  webp,
  animatedPng,
  animatedWebp,
  largeDimensionsPng,
  maxPixelsPng,
} from "../helpers/operator-images.js"
const limits = { ...OPERATOR_IMAGE_LIMITS, supported: true }

describe("operator image boundary", () => {
  const scope = Scope.makeUnsafe()
  let codecs: OperatorImageCodecs["Service"]
  beforeAll(async () => {
    codecs = await Effect.runPromise(OperatorImageCodecs.make.pipe(Effect.provideService(Scope.Scope, scope)))
  })
  afterAll(() => Effect.runPromise(Scope.close(scope, Exit.void)))
  const validateOperatorInput = (
    text: Parameters<typeof validate>[0],
    images: Parameters<typeof validate>[1],
    inputLimits: Parameters<typeof validate>[2],
  ) => validate(text, images, inputLimits, codecs)

  it("keeps text-only callers working and allows image-only input", async () => {
    expect(await validateOperatorInput("text", [], imageInputFor(undefined))).toEqual([])
    expect(await validateOperatorInput("", [png], limits)).toEqual([
      { index: 0, mimeType: "image/png", byteLength: 70, width: 1, height: 1 },
    ])
  })
  it("accepts static JPEG/WebP and rejects animation and excessive dimensions", async () => {
    expect((await validateOperatorInput("", [jpeg, webp], limits)).map((image) => image.mimeType)).toEqual([
      "image/jpeg",
      "image/webp",
    ])
    await expect(validateOperatorInput("", [animatedPng], limits)).rejects.toThrow("Animated")
    await expect(validateOperatorInput("", [animatedWebp], limits)).rejects.toThrow("Animated")
    await expect(validateOperatorInput("", [largeDimensionsPng], limits)).rejects.toThrow("dimension")
  })
  it("rejects empty, non-vision, unsupported, MIME-mismatched, corrupt and noncanonical data", async () => {
    await expect(validateOperatorInput(" ", [], limits)).rejects.toThrow("Enter text")
    await expect(validateOperatorInput("", [png], imageInputFor(undefined))).rejects.toThrow("fixed model")
    await Promise.all(
      [
        { ...png, mimeType: "image/jpeg" },
        { mimeType: "image/svg+xml", data: Buffer.from("<svg/>").toString("base64") },
        { ...png, data: png.data.slice(0, -8) },
        { ...png, data: "https://example.com/a.png" },
        { ...png, data: `data:image/png;base64,${png.data}` },
        { ...png, data: `${png.data}\n` },
      ].map((image) => expect(validateOperatorInput("look", [image], limits)).rejects.toThrow()),
    )
  })
  it.each(corruptCompressedImages)(
    "rejects corrupt compressed pixels in $mimeType with valid metadata/framing",
    async (image) => {
      await expect(validateOperatorInput("", [image], limits)).rejects.toThrow()
    },
  )
  it("bounds PNG inflation and rejects a WebP frame hidden behind a smaller canvas", async () => {
    const original = Buffer.from(png.data, "base64")
    const compressed = deflateSync(Buffer.alloc(1024))
    const chunk = Buffer.alloc(compressed.length + 12)
    chunk.writeUInt32BE(compressed.length)
    chunk.write("IDAT", 4)
    compressed.copy(chunk, 8)
    chunk.writeUInt32BE(Bun.hash.crc32(chunk.subarray(4, -4)), chunk.length - 4)
    const excessiveInflation = {
      ...png,
      data: Buffer.concat([original.subarray(0, 33), chunk, original.subarray(-12)]).toString("base64"),
    }
    await expect(validateOperatorInput("", [excessiveInflation], limits)).rejects.toThrow("compressed pixel")

    const bytes = Buffer.from(webp.data, "base64")
    const canvas = Buffer.alloc(18)
    canvas.write("VP8X")
    canvas.writeUInt32LE(10, 4)
    // Canvas 1x1, but the underlying VP8L header now declares 16384x16384.
    bytes.writeUInt32LE(0x0fffffff, 21)
    const hiddenFrame = Buffer.concat([bytes.subarray(0, 12), canvas, bytes.subarray(12)])
    hiddenFrame.writeUInt32LE(hiddenFrame.length - 8, 4)
    await expect(
      validateOperatorInput("", [{ ...webp, data: hiddenFrame.toString("base64") }], limits),
    ).rejects.toThrow("dimensions")
  })
  it("keeps unrelated timers progressing while decoding a genuine image at the inclusive 20 MP limit", async () => {
    await validateOperatorInput("", [png], limits)
    const image = maxPixelsPng()
    let ticks = 0
    const timer = setInterval(() => ticks++, 5)
    try {
      expect(await validateOperatorInput("", [image], limits)).toMatchObject([{ width: 5000, height: 4000 }])
      expect(ticks).toBeGreaterThan(0)
    } finally {
      clearInterval(timer)
    }
  })
  it("applies pixel caps before calling any decoder", async () => {
    const decode = vi.spyOn(codecs, "decode")
    try {
      await expect(validateOperatorInput("", [largeDimensionsPng], limits)).rejects.toThrow("dimension")
      expect(decode).not.toHaveBeenCalled()
    } finally {
      decode.mockRestore()
    }
  })
  it("enforces count, decoded, serialized and model-specific bounds", async () => {
    await expect(validateOperatorInput("", Array(5).fill(png), limits)).rejects.toThrow("at most 4")
    await expect(validateOperatorInput("", [png], { ...limits, maxImageBytes: 69 })).rejects.toThrow()
    await expect(
      validateOperatorInput("", [png, png], { ...limits, maxTotalImageBytes: 100 }),
    ).rejects.toThrow()
    await expect(
      validateOperatorInput("x".repeat(100), [], { ...limits, maxSerializedBytes: 99 }),
    ).rejects.toThrow("serialized")
    await expect(validateOperatorInput("", [png], { ...limits, maxPixels: 0 })).rejects.toThrow("dimension")
    await expect(validateOperatorInput("", [png], { ...limits, maxWidth: 0 })).rejects.toThrow("dimension")
  })
})

describe("scoped operator codec worker", () => {
  let scope: Scope.Closeable
  let codecs: OperatorImageCodecs["Service"]
  beforeEach(async () => {
    scope = Scope.makeUnsafe()
    codecs = await Effect.runPromise(OperatorImageCodecs.make.pipe(Effect.provideService(Scope.Scope, scope)))
  })
  afterEach(async () => {
    await Effect.runPromise(Scope.close(scope, Exit.void))
    vi.restoreAllMocks()
  })

  it("does not start codec work for text-only input or an already cancelled request", async () => {
    const submit = vi.spyOn(Worker.prototype, "postMessage")
    const abort = new AbortController()
    abort.abort()
    await expect(validate("text", [], limits, codecs)).resolves.toEqual([])
    await expect(validate("", [png], limits, codecs, undefined, abort.signal)).rejects.toThrow("cancelled")
    expect(submit).not.toHaveBeenCalled()
  })

  it("reuses one worker, preserves source bytes and rejects excess work without a waiting queue", async () => {
    const submit = vi.spyOn(Worker.prototype, "postMessage")
    const terminate = vi.spyOn(Worker.prototype, "terminate")
    await validate("", [png], limits, codecs)
    const image = maxPixelsPng()
    const bytes = Buffer.from(image.data, "base64")
    const original = Buffer.from(bytes)
    const decoding = codecs.decode(bytes, imageMetadata(image, 0))
    const refused = await Promise.allSettled(
      Array.from({ length: 16 }, () => validate("", [png], limits, codecs)),
    )
    for (const result of refused) {
      expect(result).toMatchObject({ status: "rejected", reason: { code: "operator-input-busy" } })
    }
    await decoding
    expect(bytes).toEqual(original)
    await validate("", [jpeg, webp], limits, codecs)
    expect(submit).toHaveBeenCalledTimes(4)
    expect(new Set(submit.mock.contexts).size).toBe(1)
    expect(terminate).not.toHaveBeenCalled()
    await Effect.runPromise(Scope.close(scope, Exit.void))
    expect(terminate).toHaveBeenCalledTimes(1)
    await expect(codecs.decode(bytes, imageMetadata(image, 0))).rejects.toThrow("closed")
  })

  it("settles an in-flight decode and awaits worker termination when its service scope closes", async () => {
    const terminate = vi.spyOn(Worker.prototype, "terminate")
    await validate("", [png], limits, codecs)
    const image = maxPixelsPng()
    const decoding = expect(validate("", [image], limits, codecs)).rejects.toThrow("shutting down")
    await Effect.runPromise(Scope.close(scope, Exit.void))
    await decoding
    expect(terminate).toHaveBeenCalledTimes(1)
    await expect(terminate.mock.results[0]?.value).resolves.toBeTypeOf("number")
  })

  it("terminates active work on cancellation instead of leaving a detached decode", async () => {
    const terminate = vi.spyOn(Worker.prototype, "terminate")
    await validate("", [png], limits, codecs)
    const image = maxPixelsPng()
    const abort = new AbortController()
    const decoding = expect(validate("", [image], limits, codecs, undefined, abort.signal)).rejects.toThrow(
      "cancelled",
    )
    abort.abort()
    await decoding
    expect(terminate).toHaveBeenCalledTimes(1)
    await expect(terminate.mock.results[0]?.value).resolves.toBeTypeOf("number")
    // A replacement may start only after the cancelled worker has actually exited.
    await expect(validate("", [png], limits, codecs)).resolves.toHaveLength(1)
  })

  it("bounds decode duration and terminates a worker that misses its deadline", async () => {
    await validate("", [png], limits, codecs)
    const image = maxPixelsPng()
    const terminate = vi.spyOn(Worker.prototype, "terminate")
    vi.useFakeTimers()
    try {
      const decoding = expect(validate("", [image], limits, codecs)).rejects.toThrow("timed out")
      vi.advanceTimersByTime(OPERATOR_IMAGE_DECODE_TIMEOUT_MS)
      await decoding
    } finally {
      vi.useRealTimers()
    }
    await Effect.runPromise(Scope.close(scope, Exit.void))
    expect(terminate).toHaveBeenCalledTimes(1)
    await expect(terminate.mock.results[0]?.value).resolves.toBeTypeOf("number")
  })
})
