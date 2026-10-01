/**
 * The media module's public surface (issue #17): the photo life cycle the
 * journal's routes mount — upload, read, remove — plus the images-by-entry
 * lookup the journal's reads and sync contributor use, and the worker
 * handler the buildWorker composition root registers. The permission rules
 * stay in the journal (they are the entry's rules): the composition root
 * wires them in as the `authorize` functions these use cases take, so this
 * module never imports upward.
 */

export {
  ALLOWED_IMAGE_CONTENT_TYPES,
  type EntryImageDto,
  EntryImageDtoSchema,
  ImageStateSchema,
  MAX_IMAGES_PER_ENTRY,
  toImageDto,
} from './contracts.ts'
export {
  generateEntryImageDerivatives,
  MEDIA_DERIVATIVES_JOB,
  MEDIA_SENT_QUEUES,
  type MediaDerivativesJobData,
  type MediaJobsDeps,
} from './jobs.ts'
export { type ImageVariant, imageObjectKey } from './keys.ts'
export {
  deleteEntryImage,
  deleteImageObjects,
  type ImageAccessRule,
  type ImageAccessTxRule,
  type IncomingImage,
  imagesOfEntries,
  type MediaActor,
  type MediaDeps,
  readEntryImage,
  type StoredImage,
  uploadEntryImage,
} from './service.ts'
export type { EntryImage } from './tables.ts'
