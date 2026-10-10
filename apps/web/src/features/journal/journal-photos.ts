import { ApiError, extractErrorCode } from '@/data/api-error.ts'
import type { StoredJournalEntryImage } from '@/data/local-store.ts'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { currentGeneration, peekFetchedImage, rememberFetchedImage } from '@/lib/photo-cache.ts'

/** The headers a hand-rolled photo request carries: the member named, the
 *  session cookie authenticating — the client middleware's shape, for the
 *  requests the generated client cannot express (multipart, binary). */
export function memberHeader(): Record<string, string> {
  const memberId = getActiveMemberId()
  return memberId === undefined ? {} : { 'x-ohana-member': memberId }
}

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
  const known = peekFetchedImage(url)
  if (known !== undefined) return known
  const fetchedAtGeneration = currentGeneration()
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: memberHeader(),
  })
  if (!response.ok) throw new ApiError(extractErrorCode(await response.json().catch(() => null)))
  return rememberFetchedImage(url, URL.createObjectURL(await response.blob()), fetchedAtGeneration)
}

/**
 * Attaches one photo to the entry (issue #17): the bytes go as a multipart
 * upload through the API — the only request in the client that carries a
 * file — and the API answers the photo's own descriptor. The entry with its
 * updated photo list arrives through the sync, the way every change does.
 *
 * The request rides XMLHttpRequest, not fetch: the editor's progress ring
 * (docs/design/screens/diary-editor.html, issue #71) needs the upload's
 * real percentage, and a request body's bytes in flight are invisible to
 * fetch. Fractions are reported through `onProgress` as they are sent.
 */
export function uploadEntryImage(
  entryId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<StoredJournalEntryImage> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', `/api/v1/journal/entries/${entryId}/images`)
    for (const [name, value] of Object.entries(memberHeader())) {
      request.setRequestHeader(name, value)
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total)
    }
    const fail = () => {
      // The transport gave no body to name a code with — the same
      // "unexpected" a failed fetch produced.
      reject(new ApiError('unexpected'))
    }
    request.onerror = fail
    request.onabort = fail
    request.onload = () => {
      let body: unknown = null
      try {
        body = JSON.parse(request.responseText) as unknown
      } catch {
        body = null
      }
      if (request.status >= 200 && request.status < 300) {
        resolve(imageFromResponse(body))
      } else {
        reject(new ApiError(extractErrorCode(body)))
      }
    }
    const form = new FormData()
    form.append('file', file)
    request.send(form)
  })
}

/** Removes one photo; the shorter list arrives through the sync. */
export async function deleteEntryImage(entryId: string, imageId: string): Promise<void> {
  const response = await fetch(`/api/v1/journal/entries/${entryId}/images/${imageId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: memberHeader(),
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
