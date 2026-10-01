import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { heicDecodeToPng, isHeicImage } from '../src/modules/media/heic.ts'

/*
 * The release image's HEIC-decoding check (issue #17, ADR-0008): the
 * worker decodes iPhone photos through the image's own `heif-dec`, and the
 * release smoke runs this script inside the shipped image on amd64 and
 * arm64 before anything is published. A decoder that is missing, or one
 * without HEVC, fails here — not on a family's first photo.
 */

const fixturePath = fileURLToPath(new URL('../src/testing/fixtures/sample.heic', import.meta.url))
const heic = await readFile(fixturePath)

if (!isHeicImage(heic)) {
  console.error('The fixture is not a HEIC file — the shipped fixture is broken')
  process.exit(1)
}

const png = await heicDecodeToPng(heic)
const meta = await sharp(png).metadata()
if (meta.format !== 'png' || meta.width === undefined || meta.width === 0) {
  console.error('heif-dec produced something sharp cannot read')
  process.exit(1)
}

console.log(`HEIC decoding verified: ${meta.width}x${String(meta.height)} px`)
