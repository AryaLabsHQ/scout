export const png = {
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
}

export const secondPng = {
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC",
}

export const jpeg = {
  mimeType: "image/jpeg",
  data: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxyiiiv3E8w//Z",
}

export const webp = { mimeType: "image/webp", data: "UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ0f/+ByKi/wEA" }

export const animatedPng = {
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAABAAAAAQAAAAAAAAAAAAEAFAAATMe+qgAAAAxJREFUeJxjYGD4DwABAwEACInC7AAAABpmY1RMAAAAAQAAAAEAAAABAAAAAAAAAAAAAQAUAADXtFR+AAAAEGZkQVQAAAACeJxj+M/AAAADAQEAqci99wAAAABJRU5ErkJggg==",
}

export const animatedWebp = {
  mimeType: "image/webp",
  data: "UklGRsQAAABXRUJQVlA4WAoAAAACAAAAAAAAAAAAQU5JTQYAAAAAAAAAAABBTk1GRgAAAAAAAAAAAAAAAAAAADIAAAJWUDggLgAAADABAJ0BKgEAAQABQCYloAADcAD++1Xj//9Lg//6XB//0uD/0uD/+tXlV6yroABBTk1GSgAAAAAAAAAAAAAAAAAAADIAAABWUDggMgAAADQBAJ0BKgEAAQAAACYloAADcAD+8ut///mwP/bz/wR6Af//0uD//pcH//S4P/SkAAAA",
}

export const largeDimensionsPng = {
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAE4gAABOICAYAAABdmIfLAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
}

/** Add a valid ancillary chunk without changing pixels, to exercise decoded transport byte limits. */
export const paddedPng = (byteLength: number) => {
  const original = Buffer.from(png.data, "base64")
  const padding = Buffer.alloc(byteLength - original.length - 12, 120)
  padding.write("Comment\0", 0, "ascii")
  const kind = Buffer.from("tEXt")
  const chunk = Buffer.alloc(padding.length + 12)
  chunk.writeUInt32BE(padding.length)
  kind.copy(chunk, 4)
  padding.copy(chunk, 8)
  chunk.writeUInt32BE(Bun.hash.crc32(Buffer.concat([kind, padding])), chunk.length - 4)
  return {
    mimeType: "image/png",
    data: Buffer.concat([original.subarray(0, -12), chunk, original.subarray(-12)]).toString("base64"),
  }
}

/** Preserve PNG framing and CRCs while destroying the compressed zlib stream. */
export const corruptPng = (() => {
  const bytes = Buffer.from(png.data, "base64")
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset)
    const end = offset + size + 12
    if (bytes.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      bytes.fill(0, offset + 8, end - 4)
      bytes.writeUInt32BE(Bun.hash.crc32(bytes.subarray(offset + 4, end - 4)), end - 4)
    }
    offset = end
  }
  return { ...png, data: bytes.toString("base64") }
})()

/** Keep SOF dimensions, SOS and EOI, but replace the entropy stream with an invalid marker. */
export const corruptJpeg = (() => {
  const bytes = Buffer.from(jpeg.data, "base64")
  const scan = bytes.indexOf(Buffer.from([0xff, 0xda]))
  const start = scan + 2 + bytes.readUInt16BE(scan + 2)
  bytes.fill(0xff, start, bytes.length - 2)
  return { ...jpeg, data: bytes.toString("base64") }
})()

/** Keep RIFF length, VP8L signature and dimensions, but destroy the lossless coding data. */
export const corruptWebp = (() => {
  const bytes = Buffer.from(webp.data, "base64")
  bytes.fill(0, 25, bytes.length - 1)
  return { ...webp, data: bytes.toString("base64") }
})()
export const corruptCompressedImages = [corruptPng, corruptJpeg, corruptWebp]
