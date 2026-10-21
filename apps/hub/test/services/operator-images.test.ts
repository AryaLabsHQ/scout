import { describe, expect, it } from "vitest"
import { OPERATOR_IMAGE_LIMITS } from "@scout/shared"
import { imageInputFor, validateOperatorInput } from "../../src/services/operator-images.js"

import { png, jpeg, webp, animatedPng, animatedWebp, largeDimensionsPng } from "../helpers/operator-images.js"
const limits = { ...OPERATOR_IMAGE_LIMITS, supported: true }

describe("operator image boundary", () => {
  it("keeps text-only callers working and allows image-only input", () => {
    expect(validateOperatorInput("text", [], imageInputFor(undefined))).toEqual([])
    expect(validateOperatorInput("", [png], limits)).toEqual([
      { index: 0, mimeType: "image/png", byteLength: 70, width: 1, height: 1 },
    ])
  })
  it("accepts static JPEG/WebP and rejects animation and excessive dimensions", () => {
    expect(validateOperatorInput("", [jpeg, webp], limits).map((image) => image.mimeType)).toEqual([
      "image/jpeg",
      "image/webp",
    ])
    expect(() => validateOperatorInput("", [animatedPng], limits)).toThrow("Animated")
    expect(() => validateOperatorInput("", [animatedWebp], limits)).toThrow("Animated")
    expect(() => validateOperatorInput("", [largeDimensionsPng], limits)).toThrow("dimension")
  })
  it("rejects empty, non-vision, unsupported, MIME-mismatched, corrupt and noncanonical data", () => {
    expect(() => validateOperatorInput(" ", [], limits)).toThrow("Enter text")
    expect(() => validateOperatorInput("", [png], imageInputFor(undefined))).toThrow("fixed model")
    for (const image of [
      { ...png, mimeType: "image/jpeg" },
      { mimeType: "image/svg+xml", data: Buffer.from("<svg/>").toString("base64") },
      { ...png, data: png.data.slice(0, -8) },
      { ...png, data: "https://example.com/a.png" },
      { ...png, data: `data:image/png;base64,${png.data}` },
      { ...png, data: `${png.data}\n` },
    ])
      expect(() => validateOperatorInput("look", [image], limits)).toThrow()
  })
  it("enforces count, decoded, serialized and model-specific bounds", () => {
    expect(() => validateOperatorInput("", Array(5).fill(png), limits)).toThrow("at most 4")
    expect(() => validateOperatorInput("", [png], { ...limits, maxImageBytes: 69 })).toThrow()
    expect(() => validateOperatorInput("", [png, png], { ...limits, maxTotalImageBytes: 100 })).toThrow()
    expect(() => validateOperatorInput("x".repeat(100), [], { ...limits, maxSerializedBytes: 99 })).toThrow(
      "serialized",
    )
    expect(() => validateOperatorInput("", [png], { ...limits, maxPixels: 0 })).toThrow("dimension")
    expect(() => validateOperatorInput("", [png], { ...limits, maxWidth: 0 })).toThrow("dimension")
  })
})
