import { useEffect, useState } from "react"
import type { OperatorImage } from "@scout/shared"
import { imageBlob } from "./operator-image-input"

export function OperatorImagePreview({ image, alt }: { image: OperatorImage; alt: string }) {
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState(false)
  const { data, mimeType } = image
  useEffect(() => {
    try {
      const next = URL.createObjectURL(imageBlob({ data, mimeType }))
      setUrl(next)
      setError(false)
      return () => URL.revokeObjectURL(next)
    } catch {
      setUrl(undefined)
      setError(true)
    }
  }, [data, mimeType])
  if (error)
    return (
      <p role="alert" className="text-xs text-err">
        This image could not be displayed.
      </p>
    )
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${alt.toLowerCase()} at full size`}>
      <img
        src={url}
        alt={alt}
        onError={() => setError(true)}
        className="max-h-80 max-w-full rounded-md border border-border object-contain"
      />
    </a>
  ) : null
}
