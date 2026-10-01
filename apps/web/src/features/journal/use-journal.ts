import type { paths } from '@ohana/api-client'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { ApiError, assertOk } from '@/data/api-error.ts'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { triggerSync } from '@/data/sync-engine.ts'
import { sectionDownloaded, useSyncedSpace } from '@/features/member/use-synced-space.ts'

/*
 * The journal's server data (issues #15 and #16): reads of synchronised
 * data come from the member's synchronised partition — the same answer
 * online and offline (ADR-0002) — and the mutations go to the API through
 * the generated client. A success triggers a sync, and so does every
 * refusal: the journal screens read the refused row or map from the local
 * store, so the sync is what corrects it (architecture.md, web rules) —
 * author_required and entry_not_found name a stale row, section_hidden a
 * stale map, entry_already_published an entry published elsewhere. The
 * trash is the exception on the read side: a trashed entry has left every
 * member's synchronised partition (its tombstones saw to that), so the
 * trash view asks the server with an ordinary query — online-only data,
 * like the administrative area and the session lists.
 */

export type CreatedEntry =
  paths['/api/v1/journal/entries']['post']['responses'][201]['content']['application/json']

export type EntryDto =
  paths['/api/v1/journal/entries/{entryId}']['get']['responses'][200]['content']['application/json']

export type TrashedEntryDto =
  paths['/api/v1/journal/entries/{entryId}/trash']['post']['responses'][200]['content']['application/json']

export interface JournalInput {
  title?: string
  text: string
}

/** The editor's client-side guard, mirroring the API contract's bounds. */
export const ENTRY_TITLE_MAX_LENGTH = 200
export const ENTRY_TEXT_MAX_LENGTH = 20_000

/**
 * The synchronised entries and profiles the journal screens read, plus
 * whether the device may claim journal data at all: while the journal is
 * the section a replay promise names (a re-show or the store upgrade,
 * ADR-0014), the store may hold only a fraction of it, and "empty" — or a
 * lone entry as the whole feed — would be a claim the device cannot make.
 */
export function useJournalData() {
  const snapshot = useSyncedSpace()
  const entries = snapshot.data?.entries ?? []
  const profiles = snapshot.data?.members ?? []
  const downloaded = sectionDownloaded(snapshot.data, 'journal')
  return { snapshot, entries, profiles, downloaded }
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

/** PUT /api/v1/journal/entries/{entryId} — the author's edit, in any state: the whole pair is replaced. */
export function useUpdateEntry() {
  return useMutation({
    mutationFn: async (input: { entryId: string } & JournalInput): Promise<EntryDto> => {
      const response = await api.PUT('/api/v1/journal/entries/{entryId}', {
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

/**
 * GET /api/v1/journal/trash — the trashed entries this member may see, each
 * with its permanent-deletion date. Online-only: the trashed rows have left
 * every device's synchronised partition, so the view asks the server. The
 * list holds trashed drafts only their author may see, so it is tied to one
 * member: the query names that member and keys on them (architecture.md,
 * web rules).
 */
export function useTrash() {
  const memberId = getActiveMemberId()
  return useQuery({
    queryKey: ['member', memberId, 'journal', 'trash'],
    queryFn:
      memberId === undefined
        ? skipToken
        : async (): Promise<{ entries: TrashedEntryDto[] }> => {
            const response = await api.GET('/api/v1/journal/trash', {
              params: { header: { 'x-ohana-member': memberId } },
            })
            await assertOk(response)
            if (response.data === undefined) throw new ApiError('unexpected')
            return response.data
          },
  })
}

/** POST /api/v1/journal/entries/{entryId}/trash — the removal into trash. */
export function useTrashEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { entryId: string }): Promise<TrashedEntryDto> => {
      const response = await api.POST('/api/v1/journal/entries/{entryId}/trash', {
        params: { path: { entryId: input.entryId } },
      })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    // The trash list is online-only data: no sync carries it, so the
    // mutation re-probes it (and the synchronised partition via the sync).
    onSuccess: () => {
      void triggerSync()
      void queryClient.invalidateQueries({
        queryKey: ['member', getActiveMemberId(), 'journal', 'trash'],
      })
    },
    onError: () => void triggerSync(),
  })
}

/** POST /api/v1/journal/entries/{entryId}/restore — the way back out. */
export function useRestoreEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { entryId: string }): Promise<EntryDto> => {
      const response = await api.POST('/api/v1/journal/entries/{entryId}/restore', {
        params: { path: { entryId: input.entryId } },
      })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    onSuccess: () => {
      void triggerSync()
      void queryClient.invalidateQueries({
        queryKey: ['member', getActiveMemberId(), 'journal', 'trash'],
      })
    },
    // A refusal may be the answer about the row (entry_purge_due, a row
    // the view should no longer offer): the trash list is online-only
    // data, so the refusal re-probes it instead of patching it by hand.
    onError: () => {
      void triggerSync()
      void queryClient.invalidateQueries({
        queryKey: ['member', getActiveMemberId(), 'journal', 'trash'],
      })
    },
  })
}

type JournalErrorKey =
  | 'journal.errors.entry_not_found'
  | 'journal.errors.author_required'
  | 'journal.errors.entry_already_published'
  | 'journal.errors.trash_forbidden'
  | 'journal.errors.restore_forbidden'
  | 'journal.errors.entry_not_trashed'
  | 'journal.errors.entry_purge_due'
  | 'journal.errors.section_hidden'
  | 'journal.errors.validation_failed'
  | 'journal.errors.unexpected'

const journalErrorKeys: Partial<Record<string, JournalErrorKey>> = {
  entry_not_found: 'journal.errors.entry_not_found',
  author_required: 'journal.errors.author_required',
  entry_already_published: 'journal.errors.entry_already_published',
  trash_forbidden: 'journal.errors.trash_forbidden',
  restore_forbidden: 'journal.errors.restore_forbidden',
  entry_not_trashed: 'journal.errors.entry_not_trashed',
  entry_purge_due: 'journal.errors.entry_purge_due',
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
