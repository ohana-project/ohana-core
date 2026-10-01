import type { paths } from '@ohana/api-client'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { ApiError, assertOk } from '@/data/api-error.ts'
import { triggerSync } from '@/data/sync-engine.ts'
import { useSyncedSpace } from '@/features/member/use-synced-space.ts'

/*
 * The journal's server data (issue #15): reads come from the member's
 * synchronised partition — the same answer online and offline (ADR-0002) —
 * and the three mutations go to the API through the generated client. A
 * mutation triggers a sync on success and on failure alike: the store then
 * learns the change the ordinary way, and a refusal from a stale row
 * (already published elsewhere, removed) clears itself instead of
 * lingering (architecture.md, web rules — no hook here patches the cache
 * by hand).
 */

export type CreatedEntry =
  paths['/api/v1/journal/entries']['post']['responses'][201]['content']['application/json']

export type EntryDto =
  paths['/api/v1/journal/entries/{entryId}']['get']['responses'][200]['content']['application/json']

export interface JournalInput {
  title?: string
  text: string
}

/** The editor's client-side guard, mirroring the API contract's bounds. */
export const ENTRY_TITLE_MAX_LENGTH = 200
export const ENTRY_TEXT_MAX_LENGTH = 20_000

/** The synchronised entries and profiles the journal screens read. */
export function useJournalData() {
  const snapshot = useSyncedSpace()
  const entries = snapshot.data?.entries ?? []
  const profiles = snapshot.data?.members ?? []
  return { snapshot, entries, profiles }
}

/** POST /api/v1/journal/entries — a new entry, always a draft. */
export function useCreateDraft() {
  return useMutation({
    mutationFn: async (input: JournalInput): Promise<CreatedEntry> => {
      const response = await api.POST('/api/v1/journal/entries', { body: input })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    onSuccess: () => void triggerSync(),
    onError: () => void triggerSync(),
  })
}

/** PATCH /api/v1/journal/entries/{entryId} — the author's edit, in any state. */
export function useUpdateEntry() {
  return useMutation({
    mutationFn: async (input: { entryId: string } & JournalInput): Promise<EntryDto> => {
      const response = await api.PATCH('/api/v1/journal/entries/{entryId}', {
        params: { path: { entryId: input.entryId } },
        body: { title: input.title, text: input.text },
      })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    onSuccess: () => void triggerSync(),
    onError: () => void triggerSync(),
  })
}

/** POST /api/v1/journal/entries/{entryId}/publish — the one-way transition. */
export function usePublishEntry() {
  return useMutation({
    mutationFn: async (input: { entryId: string }): Promise<EntryDto> => {
      const response = await api.POST('/api/v1/journal/entries/{entryId}/publish', {
        params: { path: { entryId: input.entryId } },
      })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    onSuccess: () => void triggerSync(),
    onError: () => void triggerSync(),
  })
}

type JournalErrorKey =
  | 'journal.errors.entry_not_found'
  | 'journal.errors.author_required'
  | 'journal.errors.entry_already_published'
  | 'journal.errors.section_hidden'
  | 'journal.errors.validation_failed'
  | 'journal.errors.unexpected'

const journalErrorKeys: Partial<Record<string, JournalErrorKey>> = {
  entry_not_found: 'journal.errors.entry_not_found',
  author_required: 'journal.errors.author_required',
  entry_already_published: 'journal.errors.entry_already_published',
  section_hidden: 'journal.errors.section_hidden',
  validation_failed: 'journal.errors.validation_failed',
}

/** Translates a stable API error code into the caller's locale. */
export function journalErrorMessage(
  error: unknown,
  translate: (key: JournalErrorKey) => string,
): string {
  if (error instanceof ApiError) {
    const key = journalErrorKeys[error.code]
    if (key !== undefined) return translate(key)
  }
  return translate('journal.errors.unexpected')
}
