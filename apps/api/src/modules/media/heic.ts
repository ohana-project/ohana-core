import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/*
 * HEIC decoding (issue #17, ADR-0008): sharp's prebuilt libvips carries
 * libheif but no HEVC decoder, so an iPhone photo answers
 * "Support for this compression format has not been built in: HEVC". The
 * worker image therefore provides `heif-dec` (the libheif CLI, with
 * libde265), and this module shells out to it — the release image's
 * decoding is verified on both amd64 and arm64 by the release smoke test.
 */

/** The ISO base media file brands a still HEIC/HEIF photo may carry. */
const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
])

/**
 * True when the bytes open with an `ftyp` box whose major brand names a
 * HEIF still image. Only the bytes are asked — a renamed file decodes by
 * what it is, and an AVIF (`avif` brand) is left to sharp, which has AV1.
 */
export function isHeicImage(bytes: Buffer): boolean {
  if (bytes.length < 12) return false
  if (bytes.subarray(4, 8).toString('latin1') !== 'ftyp') return false
  return HEIC_BRANDS.has(bytes.subarray(8, 12).toString('latin1'))
}

export class HeicDecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'HeicDecodeError'
  }
}

/**
 * Decodes a HEIC photo into a lossless PNG through the libheif CLI the
 * worker image provides (`heif-dec`; the distribution's `heif-convert`
 * decodes just the same). The bytes travel through a private temporary
 * directory that is always removed; a decoder that is missing (not
 * installed) or refuses the file raises HeicDecodeError either way — the
 * caller marks the photo failed, and the queue's retry decides whether a
 * transient environment fixes itself.
 */
export async function heicDecodeToPng(input: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'ohana-heic-'))
  try {
    const inputPath = join(dir, 'input.heic')
    const outputPath = join(dir, 'decoded.png')
    await writeFile(inputPath, input)
    // The output is the positional argument: it is the one interface every
    // libheif the code may meet — the release image's 1.23, the CI runner's
    // older 1.17, a developer's Homebrew build — accepts. The newer
    // distributions name the tool `heif-dec`; Debian and Ubuntu kept
    // `heif-convert` for longer, and it decodes just the same. A binary
    // that is absent moves the attempt to the next name; every other
    // outcome — a refusal, or both names missing — is one decode failure.
    let lastCause: unknown
    let decoded = false
    for (const binary of ['heif-dec', 'heif-convert']) {
      try {
        await execFileAsync(binary, [inputPath, outputPath], { timeout: 60_000 })
        decoded = true
        break
      } catch (cause) {
        lastCause = cause
        if ((cause as { code?: string }).code !== 'ENOENT') break
      }
    }
    if (!decoded) {
      const missing = (lastCause as { code?: string }).code === 'ENOENT'
      throw new HeicDecodeError(
        missing
          ? 'no HEIC decoder is installed (heif-dec, heif-convert)'
          : 'the HEIC decoder refused the photo',
        { cause: lastCause },
      )
    }
    try {
      return await readFile(outputPath)
    } catch (cause) {
      // An exit-0 run that wrote nothing is the decoder's failure to
      // produce, not a missing file to crash on.
      throw new HeicDecodeError('the HEIC decoder wrote no output', { cause })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
