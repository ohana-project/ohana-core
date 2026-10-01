import sharp from 'sharp'
import { heicDecodeToPng, isHeicImage } from './heic.ts'

/*
 * The derivative generator (issue #17, ADR-0008): the worker turns one
 * original photo into two metadata-free WebP derivatives — `feed` for the
 * lists and `full` for the viewer — while the original itself is never
 * rewritten. sharp strips every metadata by default, so the derivatives
 * carry no EXIF and no GPS; `rotate()` applies the orientation the EXIF
 * named, because after stripping there is nothing left to orient by.
 */

/** The longest edge of the feed preview. */
export const FEED_MAX_EDGE = 1200

/** The longest edge of the viewer image. */
export const FULL_MAX_EDGE = 2560

export interface Derivative {
  variant: 'feed' | 'full'
  bytes: Buffer
  width: number
  height: number
}

/**
 * An input the pipeline can decode: the original's bytes directly, or the
 * PNG a HEIC photo first became through `heif-dec` (sharp has no HEVC).
 */
async function decodedInput(original: Buffer): Promise<Buffer> {
  return isHeicImage(original) ? heicDecodeToPng(original) : original
}

function reshape(source: Buffer, maxEdge: number, quality: number) {
  return sharp(source)
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true })
}

/**
 * Produces both derivatives of one original. The original's bytes are read
 * only; a photo that cannot be decoded — a corrupt upload, or a HEIC the
 * installed decoder refuses — raises, and the caller marks the photo
 * failed rather than storing half a set.
 */
export async function generateDerivatives(original: Buffer): Promise<Derivative[]> {
  const source = await decodedInput(original)
  // The feed first: its measured size is what the row records and the
  // screens lay the strip out with.
  const feed = await reshape(source, FEED_MAX_EDGE, 80)
  const full = await reshape(source, FULL_MAX_EDGE, 85)
  return [
    { variant: 'feed', bytes: feed.data, width: feed.info.width, height: feed.info.height },
    { variant: 'full', bytes: full.data, width: full.info.width, height: full.info.height },
  ]
}
