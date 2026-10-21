import {
  initializeImageMagick,
  MagickFormat,
  MagickImage,
  MagickReadSettings,
  ResourceLimits,
} from "@imagemagick/magick-wasm"
import magickWasm from "@imagemagick/magick-wasm/magick.wasm" with { type: "file" }
import { OPERATOR_IMAGE_LIMITS, type OperatorImageMetadata } from "@scout/shared"

let ready: Promise<void> | undefined

/** Decode for validity only; native admission retains the original compressed bytes. */
export async function decodeOperatorImage(bytes: Buffer, metadata: OperatorImageMetadata) {
  // Bun embeds this file in the executable, with no native addons or adjacent runtime assets.
  ready ??= Bun.file(magickWasm)
    .bytes()
    .then(async (wasm) => {
      await initializeImageMagick(wasm)
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
    })
  await ready
  const format = {
    "image/png": MagickFormat.Png,
    "image/jpeg": MagickFormat.Jpeg,
    "image/webp": MagickFormat.WebP,
  }[metadata.mimeType]
  if (format === undefined) throw new Error("Unsupported image codec")
  const image = MagickImage.create()
  try {
    // Some codecs recover truncated pixels with a warning; admission must reject those too.
    let warned = false
    image.onWarning = () => {
      warned = true
    }
    image.read(bytes, new MagickReadSettings({ format, frameCount: 1 }))
    if (warned || image.width !== metadata.width || image.height !== metadata.height) {
      throw new Error("Invalid pixels or inconsistent image dimensions")
    }
  } finally {
    image.dispose()
  }
}
