import type { paths } from '@ohana/api-client'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { ApiError, assertOk } from '@/data/api-error.ts'
import { triggerSync } from '@/data/sync-engine.ts'
import { sectionDownloaded, useSyncedSpace } from '@/features/member/use-synced-space.ts'

/*
 * The wishlist's server data (issue #18): reads of synchronised data come
 * from the member's synchronised partition — the same answer online and
 * offline (ADR-0002) — and the mutations go to the API through the
 * generated client. A success triggers a sync, and so does every refusal:
 * the wishlist screens read the refused row or map from the local store,
 * so the sync is what corrects it (architecture.md, web rules) —
 * author_required names a stale row, section_hidden a stale map.
 */

export type WishDto =
  paths['/api/v1/wishlist/wishes']['post']['responses'][201]['content']['application/json']

export interface WishInput {
  title: string
  details?: string
  link?: string
}

/** The editor's client-side guard, mirroring the API contract's bounds. */
export const WISH_TITLE_MAX_LENGTH = 200
export const WISH_DETAILS_MAX_LENGTH = 2_000
export const WISH_LINK_MAX_LENGTH = 2_048

/**
 * The synchronised wishes and profiles the wishlist screens read, plus
 * whether the device may claim wishlist data at all: while the wishlist is
 * the section a replay promise names (a re-show or the store upgrade,
 * ADR-0014), the store may hold only a fraction of it, and "empty" would
 * be a claim the device cannot make.
 */
export function useWishlistData() {
  const snapshot = useSyncedSpace()
  const wishes = snapshot.data?.wishes ?? []
  const profiles = snapshot.data?.members ?? []
  const downloaded = sectionDownloaded(snapshot.data, 'wishlist')
  return { snapshot, wishes, profiles, downloaded }
}

/** POST /api/v1/wishlist/wishes — a new wish on the member's own list. */
export function useCreateWish() {
  return useMutation({
    mutationFn: async (input: WishInput): Promise<WishDto> => {
      const response = await api.POST('/api/v1/wishlist/wishes', { body: input })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    onSuccess: () => void triggerSync(),
    onError: () => void triggerSync(),
  })
}

/** PUT /api/v1/wishlist/wishes/{wishId} — the author's edit, a whole replace. */
export function useUpdateWish() {
  return useMutation({
    mutationFn: async (input: { wishId: string } & WishInput): Promise<WishDto> => {
      const response = await api.PUT('/api/v1/wishlist/wishes/{wishId}', {
        params: { path: { wishId: input.wishId } },
        body: { title: input.title, details: input.details, link: input.link },
      })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    onSuccess: () => void triggerSync(),
    onError: () => void triggerSync(),
  })
}

/** DELETE /api/v1/wishlist/wishes/{wishId} — the removal, a true delete. */
export function useDeleteWish() {
  return useMutation({
    mutationFn: async (input: { wishId: string }): Promise<void> => {
      const response = await api.DELETE('/api/v1/wishlist/wishes/{wishId}', {
        params: { path: { wishId: input.wishId } },
      })
      await assertOk(response)
    },
    onSuccess: () => void triggerSync(),
    onError: () => void triggerSync(),
  })
}

/** POST /api/v1/wishlist/wishes/{wishId}/received — the author's mark. */
export function useMarkWishReceived() {
  return useMutation({
    mutationFn: async (input: { wishId: string }): Promise<WishDto> => {
      const response = await api.POST('/api/v1/wishlist/wishes/{wishId}/received', {
        params: { path: { wishId: input.wishId } },
      })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    onSuccess: () => void triggerSync(),
    onError: () => void triggerSync(),
  })
}

/** DELETE /api/v1/wishlist/wishes/{wishId}/received — the way back to open. */
export function useClearWishReceived() {
  return useMutation({
    mutationFn: async (input: { wishId: string }): Promise<WishDto> => {
      const response = await api.DELETE('/api/v1/wishlist/wishes/{wishId}/received', {
        params: { path: { wishId: input.wishId } },
      })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    onSuccess: () => void triggerSync(),
    onError: () => void triggerSync(),
  })
}

type WishlistErrorKey =
  | 'wishlist.errors.wish_not_found'
  | 'wishlist.errors.author_required'
  | 'wishlist.errors.wish_already_received'
  | 'wishlist.errors.wish_not_received'
  | 'wishlist.errors.section_hidden'
  | 'wishlist.errors.validation_failed'
  | 'wishlist.errors.unexpected'

const wishlistErrorKeys: Partial<Record<string, WishlistErrorKey>> = {
  wish_not_found: 'wishlist.errors.wish_not_found',
  author_required: 'wishlist.errors.author_required',
  wish_already_received: 'wishlist.errors.wish_already_received',
  wish_not_received: 'wishlist.errors.wish_not_received',
  section_hidden: 'wishlist.errors.section_hidden',
  validation_failed: 'wishlist.errors.validation_failed',
}

/** Translates a stable API error code into the caller's locale. */
export function wishlistErrorMessage(
  error: unknown,
  translate: (key: WishlistErrorKey) => string,
): string {
  if (error instanceof ApiError) {
    const key = wishlistErrorKeys[error.code]
    if (key !== undefined) return translate(key)
  }
  return translate('wishlist.errors.unexpected')
}
