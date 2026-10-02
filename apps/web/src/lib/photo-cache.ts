/**
 * The name of the service worker's cache of journal photo derivatives
 * (issue #17): the feed and viewer images a member has viewed are kept for
 * offline reading. The name is shared between the build (vite.config's
 * workbox runtime caching) and the runtime (a sign-out deletes the cache
 * whole — the previews are the one cached API response, and they must not
 * outlive the session that viewed them).
 */
export const JOURNAL_PHOTO_CACHE = 'journal-photos'

/**
 * The object URLs handed out for fetched photos (issue #17), so a
 * re-render reuses them. Entries leave the memo without revoking: the URL
 * strings stay alive in the query cache, and a revoked URL there would be
 * a broken image that never refetches. The blobs die with the document —
 * bounded by a session's viewing — and a sign-out revokes them all.
 */
const fetchedImages = new Map<string, string>()

/** The memo is not a store; this only bounds its growth. */
const FETCHED_IMAGES_LIMIT = 120

/**
 * The generation a fetch belongs to: a sign-out bumps it, and a fetch that
 * was still in flight answers to a session that no longer exists — its
 * blob is revoked, not remembered.
 */
let generation = 0

export function currentGeneration(): number {
  return generation
}

export function rememberFetchedImage(
  url: string,
  objectUrl: string,
  fetchedAtGeneration: number,
): string {
  if (fetchedAtGeneration !== generation) {
    // The session the fetch was started for is gone: the blob is revoked,
    // and the dead URL is refused — an eager query cache under an infinite
    // staleTime would otherwise hold a broken image forever.
    URL.revokeObjectURL(objectUrl)
    throw new Error('the session ended before the photo arrived')
  }
  fetchedImages.set(url, objectUrl)
  if (fetchedImages.size > FETCHED_IMAGES_LIMIT) {
    const oldest = fetchedImages.keys().next().value
    if (oldest !== undefined) fetchedImages.delete(oldest)
  }
  return objectUrl
}

export function peekFetchedImage(url: string): string | undefined {
  return fetchedImages.get(url)
}

/** Revokes and forgets every fetched photo. The sign-out calls it — the
 *  blobs must not outlive the session that viewed them, including the ones
 *  still in flight when it happened. */
export function forgetFetchedImages(): void {
  generation += 1
  for (const objectUrl of fetchedImages.values()) URL.revokeObjectURL(objectUrl)
  fetchedImages.clear()
}
