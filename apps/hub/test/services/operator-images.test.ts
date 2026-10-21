import { deflateSync } from "node:zlib"
import { describe, expect, it, vi } from "vitest"
import { OPERATOR_IMAGE_LIMITS } from "@scout/shared"
import * as codecs from "../../src/services/operator-image-codecs.js"
import { imageInputFor, validateOperatorInput } from "../../src/services/operator-images.js"

import {
  corruptCompressedImages,
  png,
  jpeg,
  webp,
  animatedPng,
  animatedWebp,
  largeDimensionsPng,
} from "../helpers/operator-images.js"
const limits = { ...OPERATOR_IMAGE_LIMITS, supported: true }

describe("operator image boundary", () => {
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
  it("decodes a valid image at the inclusive 20 MP limit", async () => {
    const width = 5000
    const height = 4000
    const header = Buffer.from(png.data, "base64").subarray(0, 33)
    header.writeUInt32BE(width, 16)
    header.writeUInt32BE(height, 20)
    header.writeUInt32BE(Bun.hash.crc32(header.subarray(12, 29)), 29)
    const compressed = deflateSync(Buffer.alloc((width * 4 + 1) * height))
    const chunk = Buffer.alloc(compressed.length + 12)
    chunk.writeUInt32BE(compressed.length)
    chunk.write("IDAT", 4)
    compressed.copy(chunk, 8)
    chunk.writeUInt32BE(Bun.hash.crc32(chunk.subarray(4, -4)), chunk.length - 4)
    const data = Buffer.concat([header, chunk, Buffer.from(png.data, "base64").subarray(-12)]).toString(
      "base64",
    )
    expect(await validateOperatorInput("", [{ ...png, data }], limits)).toMatchObject([{ width, height }])
  })
  it("applies pixel caps before calling any decoder", async () => {
    const decode = vi.spyOn(codecs, "decodeOperatorImage")
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
