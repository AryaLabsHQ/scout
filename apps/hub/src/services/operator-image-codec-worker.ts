import { parentPort } from "node:worker_threads"
import { Schema } from "effect"
import { OperatorImageDecodeRequest } from "./operator-image-codec-protocol.js"
import {
  initializeImageMagick,
  MagickFormat,
  MagickImage,
  MagickReadSettings,
  ResourceLimits,
} from "@imagemagick/magick-wasm"
import magickWasm from "@imagemagick/magick-wasm/magick.wasm" with { type: "file" }
import { OPERATOR_IMAGE_LIMITS } from "@scout/shared"

const port = parentPort
if (port === null) throw new Error("Image decoder requires a worker thread")

// This asset is embedded alongside the worker entrypoint in the standalone hub executable.
await initializeImageMagick(await Bun.file(magickWasm).bytes())
// ImageMagick's thresholds are exclusive; Scout admits exactly maxPixels, even at width 1.
const pixelThreshold = BigInt(OPERATOR_IMAGE_LIMITS.maxPixels) + 1n
ResourceLimits.area = pixelThreshold
ResourceLimits.width = pixelThreshold
ResourceLimits.height = pixelThreshold
ResourceLimits.memory = 384n * 1024n * 1024n
ResourceLimits.maxMemoryRequest = 256n * 1024n * 1024n
ResourceLimits.maxProfileSize = BigInt(OPERATOR_IMAGE_LIMITS.maxImageBytes)
ResourceLimits.disk = 0n
ResourceLimits.listLength = 5n

port.on("message", (message: unknown) => {
  let valid = false
  let image: ReturnType<typeof MagickImage.create> | undefined
  try {
    const { bytes, metadata } = Schema.decodeUnknownSync(OperatorImageDecodeRequest)(message)
    if (
      bytes.byteLength > OPERATOR_IMAGE_LIMITS.maxImageBytes ||
      metadata.width <= 0 ||
      metadata.height <= 0 ||
      metadata.width * metadata.height > OPERATOR_IMAGE_LIMITS.maxPixels
    )
      throw new Error("Image exceeds codec limits")
    const format = {
      "image/png": MagickFormat.Png,
      "image/jpeg": MagickFormat.Jpeg,
      "image/webp": MagickFormat.WebP,
    }[metadata.mimeType]
    if (format === undefined) throw new Error("Unsupported image codec")
    image = MagickImage.create()
    // Some codecs recover truncated pixels with a warning; admission must reject those too.
    let warned = false
    image.onWarning = () => {
      warned = true
    }
    port.postMessage({ status: "started" })
    image.read(bytes, new MagickReadSettings({ format, frameCount: 1 }))
    if (warned || image.width !== metadata.width || image.height !== metadata.height) {
      throw new Error("Invalid pixels or inconsistent image dimensions")
    }
    valid = true
  } catch {
    // Codec errors and warnings are deliberately projected to the existing admission error.
  } finally {
    image?.dispose()
  }
  port.postMessage({ status: "done", valid })
})
