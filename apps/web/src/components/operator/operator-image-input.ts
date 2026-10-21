import { OPERATOR_IMAGE_LIMITS, type OperatorImageInput, type OperatorPromptParams } from "@scout/shared"

export const DEFAULT_IMAGE_INPUT: OperatorImageInput = {
  supported: true,
  ...OPERATOR_IMAGE_LIMITS,
}

export interface DraftImage {
  readonly id: string
  readonly name: string
  readonly mimeType: string
  readonly data: string
  readonly byteLength: number
  readonly width: number
  readonly height: number
}

export function validatePrompt(
  payload: OperatorPromptParams,
  images: ReadonlyArray<DraftImage>,
  limits: OperatorImageInput,
): string | null {
  if (!payload.text.trim() && images.length === 0) return "Add text or an image before sending."
  if (images.length > 0 && !limits.supported)
    return "This session's model does not support images. Remove the images to send text."
  if (images.length > limits.maxImages) return `Attach at most ${limits.maxImages} images.`
  if (images.some((image) => image.byteLength > limits.maxImageBytes))
    return `Each image must be at most ${formatImageBytes(limits.maxImageBytes)}.`
  if (images.reduce((total, image) => total + image.byteLength, 0) > limits.maxTotalImageBytes)
    return `Images must total at most ${formatImageBytes(limits.maxTotalImageBytes)}.`
  if (
    images.some(
      (image) =>
        image.width * image.height > limits.maxPixels ||
        (limits.maxWidth !== undefined && image.width > limits.maxWidth) ||
        (limits.maxHeight !== undefined && image.height > limits.maxHeight),
    )
  )
    return "An image exceeds this model's dimension or pixel limit. Choose a smaller image."
  const maxBase64Bytes = limits.maxBase64Bytes
  if (maxBase64Bytes !== undefined && images.some((image) => image.data.length > maxBase64Bytes))
    return "An encoded image exceeds this model's limit. Choose a smaller image."
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > limits.maxSerializedBytes)
    return `The complete prompt must be at most ${formatImageBytes(limits.maxSerializedBytes)}. Shorten the text or remove an image.`
  return null
}

export function formatImageBytes(bytes: number): string {
  return `${Number((bytes / 1024 / 1024).toFixed(2))} MiB`
}

/** Only inspects bounded container headers; the browser and hub validate the image itself. */
export function validateImageContainer(bytes: Uint8Array, mimeType: string): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length))
  if (mimeType === "image/png") {
    if (
      bytes.length < 24 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    )
      throw new Error("The file is not a valid PNG image.")
    for (let offset = 8; offset + 12 <= bytes.length; ) {
      const length = view.getUint32(offset)
      if (["acTL", "fcTL", "fdAT"].includes(ascii(offset + 4, 4)))
        throw new Error("Animated images are not supported. Choose a static PNG, JPEG or WebP.")
      if (length > bytes.length - offset - 12) break
      offset += length + 12
    }
  } else if (mimeType === "image/jpeg") {
    if (bytes.length < 3 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)
      throw new Error("The file is not a valid JPEG image.")
  } else if (mimeType === "image/webp") {
    if (bytes.length < 20 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP")
      throw new Error("The file is not a valid WebP image.")
    for (let offset = 12; offset + 8 <= bytes.length; ) {
      const kind = ascii(offset, 4)
      const length = view.getUint32(offset + 4, true)
      if (kind === "ANIM" || kind === "ANMF" || (kind === "VP8X" && (bytes[offset + 8]! & 2) !== 0))
        throw new Error("Animated images are not supported. Choose a static PNG, JPEG or WebP.")
      if (length > bytes.length - offset - 8) break
      offset += 8 + length + (length % 2)
    }
  } else {
    throw new Error(
      "Only static PNG, JPEG and WebP images are supported; documents and URLs cannot be attached.",
    )
  }
}

export async function readDraftImage(file: File, limits: OperatorImageInput): Promise<DraftImage> {
  if (!limits.supported) throw new Error("This session's model does not support images.")
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error(
      "Only static PNG, JPEG and WebP images are supported; documents and URLs cannot be attached.",
    )
  if (file.size > limits.maxImageBytes)
    throw new Error(`${file.name}: each image must be at most ${formatImageBytes(limits.maxImageBytes)}.`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  validateImageContainer(bytes, file.type)
  const { imageSize } = await import("image-size")
  let dimensions: ReturnType<typeof imageSize>
  try {
    dimensions = imageSize(bytes)
  } catch {
    throw new Error(`${file.name}: image metadata is invalid or truncated.`)
  }
  const actualMime =
    dimensions.type === "png"
      ? "image/png"
      : dimensions.type === "jpg"
        ? "image/jpeg"
        : dimensions.type === "webp"
          ? "image/webp"
          : undefined
  if (actualMime !== file.type)
    throw new Error(`${file.name}: image bytes do not match PNG, JPEG or WebP MIME type.`)
  if (
    !dimensions.width ||
    !dimensions.height ||
    dimensions.width * dimensions.height > limits.maxPixels ||
    (limits.maxWidth !== undefined && dimensions.width > limits.maxWidth) ||
    (limits.maxHeight !== undefined && dimensions.height > limits.maxHeight)
  )
    throw new Error(`${file.name}: image dimensions exceed this model's limit. Choose a smaller image.`)
  if (limits.maxBase64Bytes !== undefined && Math.ceil(bytes.length / 3) * 4 > limits.maxBase64Bytes)
    throw new Error(`${file.name}: encoded image exceeds this model's limit.`)
  const url = URL.createObjectURL(file)
  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve()
      image.onerror = () => reject(new Error(`${file.name}: the browser could not read this image.`))
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: actualMime,
    data: btoa(binary),
    byteLength: bytes.length,
    width: dimensions.width,
    height: dimensions.height,
  }
}

export function imageBlob(image: { readonly data: string; readonly mimeType: string }): Blob {
  const binary = atob(image.data)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new Blob([bytes], { type: image.mimeType })
}
