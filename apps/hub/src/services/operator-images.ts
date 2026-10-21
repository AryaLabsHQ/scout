import type { Api, Model } from "@earendil-works/pi-ai"
import { imageSize } from "image-size"
import {
  ManagementError,
  OPERATOR_IMAGE_LIMITS,
  type OperatorImage,
  type OperatorImageInput,
  type OperatorImageMetadata,
} from "@scout/shared"

export const imageInputFor = (model: Model<Api> | undefined): OperatorImageInput => {
  const limits = model?.inputLimits
  const resize = limits?.images?.resize
  return {
    ...OPERATOR_IMAGE_LIMITS,
    supported: model?.input.includes("image") ?? false,
    maxImages: Math.min(
      OPERATOR_IMAGE_LIMITS.maxImages,
      limits?.images?.maxPerMessage ?? Infinity,
      limits?.images?.maxPerRequest ?? Infinity,
    ),
    maxSerializedBytes: Math.min(
      OPERATOR_IMAGE_LIMITS.maxSerializedBytes,
      limits?.maxRequestBytes ?? Infinity,
    ),
    ...(resize?.maxWidth === undefined ? {} : { maxWidth: resize.maxWidth }),
    ...(resize?.maxHeight === undefined ? {} : { maxHeight: resize.maxHeight }),
    ...(resize?.maxBytes === undefined ? {} : { maxBase64Bytes: resize.maxBytes }),
  }
}

const invalid = (message: string) => new ManagementError({ code: "operator-input-invalid", message })

/** Inspect bounded image containers without decoding pixels or transforming the submitted bytes. */
export const imageMetadata = (image: OperatorImage, index: number): OperatorImageMetadata => {
  const bytes = Buffer.from(image.data, "base64")
  let dimensions: ReturnType<typeof imageSize>
  try {
    dimensions = imageSize(bytes)
  } catch {
    throw invalid(`Image ${index + 1} has invalid or truncated image data`)
  }
  const mimeType =
    dimensions.type === undefined
      ? undefined
      : { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[dimensions.type]
  if (mimeType === undefined || image.mimeType !== mimeType) {
    throw invalid(`Image ${index + 1} must contain static PNG, JPEG or WebP data matching its MIME type`)
  }
  if (dimensions.type === "png") {
    let offset = 8
    let dataChunks = 0
    let ended = false
    while (offset + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(offset)
      const end = offset + 12 + size
      if (end > bytes.length) throw invalid(`Image ${index + 1} has a truncated PNG chunk`)
      const kind = bytes.toString("ascii", offset + 4, offset + 8)
      if (kind === "acTL" || kind === "fcTL" || kind === "fdAT")
        throw invalid("Animated PNG is not supported")
      const checksum = Bun.hash.crc32(bytes.subarray(offset + 4, end - 4))
      if (checksum !== bytes.readUInt32BE(end - 4))
        throw invalid(`Image ${index + 1} has a corrupt PNG chunk`)
      if (kind === "IDAT") dataChunks++
      offset = end
      if (kind === "IEND") {
        ended = size === 0 && offset === bytes.length
        break
      }
    }
    if (!ended || dataChunks === 0) throw invalid(`Image ${index + 1} is an incomplete PNG`)
  } else if (dimensions.type === "jpg") {
    if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
      throw invalid(`Image ${index + 1} is an incomplete JPEG`)
    }
  } else {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw invalid(`Image ${index + 1} is an incomplete WebP`)
    let offset = 12
    let frames = 0
    while (offset + 8 <= bytes.length) {
      const kind = bytes.toString("ascii", offset, offset + 4)
      const size = bytes.readUInt32LE(offset + 4)
      const end = offset + 8 + size
      if (end > bytes.length) throw invalid(`Image ${index + 1} has a truncated WebP chunk`)
      if (kind === "ANIM" || kind === "ANMF" || (kind === "VP8X" && (bytes[offset + 8]! & 2) !== 0)) {
        throw invalid("Animated WebP is not supported")
      }
      if (kind === "VP8 " || kind === "VP8L") frames++
      offset = end + (size % 2)
    }
    if (offset !== bytes.length || frames !== 1) throw invalid(`Image ${index + 1} is an invalid WebP`)
  }
  return { index, mimeType, byteLength: bytes.length, width: dimensions.width, height: dimensions.height }
}

export const validateOperatorInput = (
  text: string,
  images: ReadonlyArray<OperatorImage>,
  limits: OperatorImageInput,
  envelope?: { readonly sessionId: string; readonly requestId?: string },
): ReadonlyArray<OperatorImageMetadata> => {
  if (text.trim().length === 0 && images.length === 0) throw invalid("Enter text or attach an image")
  if (Buffer.byteLength(JSON.stringify({ ...envelope, text, images })) > limits.maxSerializedBytes) {
    throw invalid(`Submission exceeds the ${limits.maxSerializedBytes} byte serialized limit`)
  }
  if (images.length > 0 && !limits.supported)
    throw invalid("This session's fixed model does not accept images")
  if (images.length > limits.maxImages) throw invalid(`Attach at most ${limits.maxImages} images`)
  let total = 0
  return images.map((image, index) => {
    if (
      image.data.length === 0 ||
      image.data.length > Math.ceil(limits.maxImageBytes / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data)
    ) {
      throw invalid(`Image ${index + 1} is too large or is not canonical base64`)
    }
    const bytes = Buffer.from(image.data, "base64")
    if (bytes.toString("base64") !== image.data) throw invalid(`Image ${index + 1} is not canonical base64`)
    total += bytes.length
    if (bytes.length > limits.maxImageBytes || total > limits.maxTotalImageBytes) {
      throw invalid("Images exceed the per-image or combined decoded byte limit")
    }
    const metadata = imageMetadata(image, index)
    if (
      metadata.width <= 0 ||
      metadata.height <= 0 ||
      metadata.width * metadata.height > limits.maxPixels ||
      metadata.width > (limits.maxWidth ?? Infinity) ||
      metadata.height > (limits.maxHeight ?? Infinity) ||
      image.data.length > (limits.maxBase64Bytes ?? Infinity)
    ) {
      throw invalid(`Image ${index + 1} exceeds this model's image dimension or size limit`)
    }
    return metadata
  })
}
