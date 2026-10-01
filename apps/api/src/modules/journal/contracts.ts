import { type Static, Type } from '@sinclair/typebox'
import type { JournalEntry } from './tables.ts'

/*
 * The journal contracts (issue #15). An entry is a text record with an
 * optional title; photos arrive with their own ticket. The DTO names the
 * author by id only: the space's profiles travel on their own sync entity,
 * so the client attributes entries from the member store it already holds
 * and never keeps a stale name inside an entry.
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

export const EntryIdParamsSchema = Type.Object({
  entryId: Type.String({ format: 'uuid' }),
})

export const JournalEntryDtoSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    authorId: Type.String({ format: 'uuid' }),
    title: Type.Optional(Type.String()),
    text: Type.String(),
    state: EntryStateSchema,
    publishedAt: Type.Optional(Type.String({ format: 'date-time' })),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)

export type JournalEntryDto = Static<typeof JournalEntryDtoSchema>

/** Projects the entry row onto the wire shape the reads and sync share. */
export function toEntryDto(entry: JournalEntry): JournalEntryDto {
  return {
    id: entry.id,
    authorId: entry.authorMemberId,
    title: entry.title ?? undefined,
    text: entry.text,
    state: entry.state,
    publishedAt: entry.publishedAt?.toISOString(),
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
