import { type Static, Type } from '@sinclair/typebox'
import { type EntryImage, EntryImageDtoSchema, toImageDto } from '../media/index.ts'
import type { JournalEntry } from './tables.ts'

/*
 * The journal contracts (issues #15, #16, and #17). The DTO names the
 * author by id only: the space's profiles travel on their own sync entity,
 * so the client attributes entries from the member store it already holds
 * and never keeps a stale name inside an entry. A trashed entry travels on
 * its own contract — the trash view's — because it has left every ordinary
 * view (policy.ts); the tombstones its removal wrote carry it to the
 * devices that saw it before. The photos ride inside the entry (issue #17):
 * the entry's own visibility governs who sees them, so a photo needs no
 * sync entity or tombstone of its own — when the entry changes, its whole
 * self, photos included, is delivered again.
 */

export const ENTRY_TITLE_MAX_LENGTH = 200
export const ENTRY_TEXT_MAX_LENGTH = 20_000

// PostgreSQL refuses NUL inside text, so the contracts refuse it at the
// door: a payload that slips through would turn the write into a 500
// instead of a validation answer.
const titleSchema = Type.Optional(
  Type.String({ maxLength: ENTRY_TITLE_MAX_LENGTH, pattern: '^[^\\u0000]*$' }),
)

/**
 * NUL-free text carrying at least one visible character: the middle class
 * asks for a char that is neither whitespace nor NUL (\S alone would match
 * the NUL itself), and the anchored NUL-free classes refuse the rest.
 */
const textSchema = Type.String({
  minLength: 1,
  maxLength: ENTRY_TEXT_MAX_LENGTH,
  pattern: '^[^\\u0000]*[^\\s\\u0000][^\\u0000]*$',
})

export const EntryStateSchema = Type.Union([Type.Literal('draft'), Type.Literal('published')])

/** The journal module's entity name in the tombstone table. */
export const JOURNAL_ENTRY_SYNC_ENTITY = 'journal_entry'

export const EntryIdParamsSchema = Type.Object({
  entryId: Type.String({ format: 'uuid' }),
})

/** One photo of one entry (issue #17). */
export const ImageIdParamsSchema = Type.Object({
  entryId: Type.String({ format: 'uuid' }),
  imageId: Type.String({ format: 'uuid' }),
})

/**
 * The variants a photo is served in: `feed` for the lists, `full` for the
 * viewer — both worker-made, metadata-free WebP — and `original`, the
 * uploaded bytes untouched (ADR-0008), served only on an explicit open.
 */
export const ImageVariantParamsSchema = Type.Object({
  entryId: Type.String({ format: 'uuid' }),
  imageId: Type.String({ format: 'uuid' }),
  variant: Type.Union([Type.Literal('feed'), Type.Literal('full'), Type.Literal('original')]),
})

export const JournalEntryDtoSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    authorId: Type.String({ format: 'uuid' }),
    title: Type.Optional(Type.String()),
    text: Type.String(),
    state: EntryStateSchema,
    publishedAt: Type.Optional(Type.String({ format: 'date-time' })),
    // The entry's photos (issue #17), oldest first. The bytes are never
    // here — the client streams them through the journal's media routes.
    images: Type.Array(EntryImageDtoSchema),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)

export type JournalEntryDto = Static<typeof JournalEntryDtoSchema>

/**
 * An entry row with its photos attached — what every ordinary read
 * delivers, so the wire contract never shows a half-listed entry.
 */
export type JournalEntryWithImages = JournalEntry & { images: EntryImage[] }

/**
 * Projects the entry row onto the wire shape the reads and sync share.
 * The ordinary reads and sync never deliver a trashed row (policy.ts); a
 * trashed row arriving here is a programming error, and refusing loudly
 * keeps the wire contract honest.
 */
export function toEntryDto(entry: JournalEntryWithImages): JournalEntryDto {
  if (entry.state === 'trashed') {
    throw new Error('A trashed entry has no ordinary entry DTO; it travels on the trash view')
  }
  return {
    id: entry.id,
    authorId: entry.authorMemberId,
    title: entry.title ?? undefined,
    text: entry.text,
    state: entry.state,
    publishedAt: entry.publishedAt?.toISOString(),
    images: entry.images.map(toImageDto),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  }
}

/** A new entry always starts as a draft; only publishing shares it. */
export const CreateEntryBodySchema = Type.Object(
  { title: titleSchema, text: textSchema },
  { additionalProperties: false },
)

export type CreateEntryBody = Static<typeof CreateEntryBodySchema>

/**
 * Editing is a replace: the body carries the whole title-and-text pair, so
 * the route answers PUT and an absent title means "no title", never "keep
 * the old one" (the route ships with this module, so the verb is chosen
 * before anything depends on it). The state is not editable here —
 * publishing is its own use case, and a published entry never returns to
 * draft.
 */
export const UpdateEntryBodySchema = CreateEntryBodySchema

export type UpdateEntryBody = Static<typeof UpdateEntryBodySchema>

/**
 * The shared feed's keyset pagination: the first page names no cursor, a
 * later one names the published time and id of the last entry it saw. The
 * service refuses a half-named pair.
 */
export const FeedQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  before: Type.Optional(Type.String({ format: 'date-time' })),
  beforeId: Type.Optional(Type.String({ format: 'uuid' })),
})

export type FeedQuery = Static<typeof FeedQuerySchema>

export const DEFAULT_FEED_LIMIT = 20

export const JournalFeedDtoSchema = Type.Object(
  {
    entries: Type.Array(JournalEntryDtoSchema),
    hasMore: Type.Boolean(),
  },
  { additionalProperties: false },
)

export type JournalFeedDto = Static<typeof JournalFeedDtoSchema>

/** The entry's change in the sync response (issue #14, ADR-0014). */
export const JournalEntrySyncChangeSchema = Type.Object(
  { entity: Type.Literal('journal_entry'), entry: JournalEntryDtoSchema },
  { additionalProperties: false },
)

/*
 * The trash view's contract (issue #16, ADR-0007): the row remembers the
 * state it was trashed from, and the view names the permanent-deletion
 * date — trashedAt plus the instance's trash retention, computed at read
 * time so a changed retention applies to entries already in trash.
 */

export const PreviousStateSchema = Type.Union([Type.Literal('draft'), Type.Literal('published')])

export const TrashedEntryDtoSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    authorId: Type.String({ format: 'uuid' }),
    title: Type.Optional(Type.String()),
    text: Type.String(),
    previousState: PreviousStateSchema,
    trashedAt: Type.String({ format: 'date-time' }),
    purgeAt: Type.String({ format: 'date-time' }),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)

export type TrashedEntryDto = Static<typeof TrashedEntryDtoSchema>

/** Projects a trashed row onto the trash view's wire shape. The trash reads
 *  deliver trashed rows only (policy.ts); anything else arriving here is a
 *  programming error, and refusing loudly keeps the wire contract honest. */
export function toTrashedEntryDto(entry: JournalEntry, purgeAt: Date): TrashedEntryDto {
  if (entry.state !== 'trashed' || entry.trashedFromState === null || entry.trashedAt === null) {
    throw new Error('The trash view carries trashed rows only')
  }
  return {
    id: entry.id,
    authorId: entry.authorMemberId,
    title: entry.title ?? undefined,
    text: entry.text,
    previousState: entry.trashedFromState,
    trashedAt: entry.trashedAt.toISOString(),
    purgeAt: purgeAt.toISOString(),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  }
}

export const TrashListDtoSchema = Type.Object(
  { entries: Type.Array(TrashedEntryDtoSchema) },
  { additionalProperties: false },
)

export type TrashListDto = Static<typeof TrashListDtoSchema>
