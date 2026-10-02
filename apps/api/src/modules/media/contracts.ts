import { type Static, Type } from '@sinclair/typebox'
import type { EntryImage } from './tables.ts'

/*
 * The media contracts (issue #17). A photo travels to clients inside its
 * entry's DTO — the entry's own visibility rules (draft, published) govern
 * who sees it, so the photo needs no sync entity or tombstone of its own.
 * The bytes themselves are served by journal-scoped routes that stream
 * from storage; clients never receive a storage URL (ADR-0004).
 */

/**
 * How many photos one entry may carry — the «2 ИЗ 12» counter of the
 * editor prototype (docs/design/screens/diary-editor.html).
 */
export const MAX_IMAGES_PER_ENTRY = 12

/** The content types an original may carry: rasters only. SVG is refused —
 *  served same-origin from the API it could carry scripts — and everything
 *  the worker cannot read would only become a failed photo. */
export const ALLOWED_IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/avif',
] as const

export const ImageStateSchema = Type.Union([
  Type.Literal('processing'),
  Type.Literal('ready'),
  Type.Literal('failed'),
])

export const EntryImageDtoSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    state: ImageStateSchema,
    // The feed derivative's pixel size: the screens lay the photo strip
    // out with it before the bytes arrive. Present once the photo is ready.
    width: Type.Optional(Type.Integer({ minimum: 1 })),
    height: Type.Optional(Type.Integer({ minimum: 1 })),
    // What the original is, as uploaded: the viewer offers HEIC and TIFF
    // originals as a download instead of an <img> no browser can show.
    originalType: Type.String(),
  },
  { additionalProperties: false },
)

export type EntryImageDto = Static<typeof EntryImageDtoSchema>

/** Projects an image row onto the shape the entry DTO embeds. */
export function toImageDto(image: EntryImage): EntryImageDto {
  return {
    id: image.id,
    state: image.state,
    ...(image.width !== null && image.height !== null
      ? { width: image.width, height: image.height }
      : {}),
    originalType: image.originalContentType,
  }
}
