import type { ObjectStorage } from '../../platform/storage/index.ts'
/**
 * The object keys of a journal photo (issue #17), in the one form the
 * architecture prescribes: `spaces/<spaceId>/<kind>/<id>/<variant>`. The
 * original object is written once, when the upload lands, and never
 * rewritten — changing the derivative sizes or formats must not touch the
 * retained original (ADR-0008).
 */

export type ImageVariant = 'original' | 'feed' | 'full'

/** The `<kind>` segment every journal photo lives under. */
export const IMAGE_OBJECT_KIND = 'journal'

export function imageObjectKey(spaceId: string, imageId: string, variant: ImageVariant): string {
  return `spaces/${spaceId}/${IMAGE_OBJECT_KIND}/${imageId}/${variant}`
}

/** Removes every object of one photo — the removal's and the purge's
 *  cleanup. Idempotent: a missing object is already the goal. */
export async function deleteImageObjects(
  storage: ObjectStorage,
  spaceId: string,
  imageId: string,
): Promise<void> {
  for (const variant of ['original', 'feed', 'full'] as const satisfies readonly ImageVariant[]) {
    await storage.delete(imageObjectKey(spaceId, imageId, variant))
  }
}
