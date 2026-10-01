import { ApiError, extractErrorCode } from '@/data/api-error.ts'
import type { StoredJournalEntryImage } from '@/data/local-store.ts'
import { getActiveMemberId } from '@/data/session-registry.ts'

/*
 * The journal photos' data access (issue #17). Photo bytes never travel in
 * the sync payload: the screens name a photo by its entry and image ids,
 * and the bytes stream from the API on demand — the feed preview as the
 * card or gallery shows it, the viewer image in the lightbox, the original
 * only on an explicit open. The service worker caches the two derivatives
 * as they are viewed; the original is never cached and never fetched in
 * bulk (ADR-0008).
 */

export type ImageVariant = 'feed' | 'full' | 'original'

export function entryImageUrl(entryId: string, imageId: string, variant: ImageVariant): string {
  return `/api/v1/journal/entries/${entryId}/images/${imageId}/variants/${variant}`
}

/** The object URLs handed out for fetched photos, so a re-render reuses them. */
const fetchedImages = new Map<string, string>()

/** One session does not need a gallery of forgotten blobs; the oldest goes. */
const FETCHED_IMAGES_LIMIT = 120

/**
 * Fetches one photo's bytes through the authorised API (the member header
 * rides along, the session cookie authenticates) and answers an object URL.
 * Answers are remembered per URL, so scrolling a gallery does not refetch.
 */
export async function fetchEntryImage(
  entryId: string,
  imageId: string,
  variant: ImageVariant,
): Promise<string> {
  const url = entryImageUrl(entryId, imageId, variant)
  const known = fetchedImages.get(url)
  if (known !== undefined) return known
  const memberId = getActiveMemberId()
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: memberId === undefined ? undefined : { 'x-ohana-member': memberId },
  })
  if (!response.ok) throw new ApiError(extractErrorCode(await response.json().catch(() => null)))
  const objectUrl = URL.createObjectURL(await response.blob())
  fetchedImages.set(url, objectUrl)
  if (fetchedImages.size > FETCHED_IMAGES_LIMIT) {
    const oldest = fetchedImages.keys().next().value
    if (oldest !== undefined) {
      const stale = fetchedImages.get(oldest)
      if (stale !== undefined) URL.revokeObjectURL(stale)
      fetchedImages.delete(oldest)
    }
  }
  return objectUrl
}

/**
 * Attaches one photo to the entry (issue #17): the bytes go as a multipart
 * upload through the API — the only request in the client that carries a
 * file — and the API answers the photo's own descriptor. The entry with its
 * updated photo list arrives through the sync, the way every change does.
 */
export async function uploadEntryImage(
  entryId: string,
  file: File,
): Promise<StoredJournalEntryImage> {
  const memberId = getActiveMemberId()
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`/api/v1/journal/entries/${entryId}/images`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: memberId === undefined ? undefined : { 'x-ohana-member': memberId },
    body: form,
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(extractErrorCode(body))
  return imageFromResponse(body)
}

/** Removes one photo; the shorter list arrives through the sync. */
export async function deleteEntryImage(entryId: string, imageId: string): Promise<void> {
  const memberId = getActiveMemberId()
  const response = await fetch(`/api/v1/journal/entries/${entryId}/images/${imageId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: memberId === undefined ? undefined : { 'x-ohana-member': memberId },
  })
  if (!response.ok) throw new ApiError(extractErrorCode(await response.json().catch(() => null)))
}

function imageFromResponse(body: unknown): StoredJournalEntryImage {
  if (typeof body !== 'object' || body === null || !('id' in body) || !('state' in body)) {
    throw new ApiError('unexpected')
  }
  const shape = body as {
    id: string
    state: 'processing' | 'ready' | 'failed'
    width?: number
    height?: number
  }
  return {
    id: shape.id,
    state: shape.state,
    ...(shape.width !== undefined && shape.height !== undefined
      ? { width: shape.width, height: shape.height }
      : {}),
  }
}
