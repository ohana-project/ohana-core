import { type Static, Type } from '@sinclair/typebox'
import type { Wish } from './tables.ts'

/*
 * The wishlist contracts (issue #18). The DTO names the author by id only:
 * the space's profiles travel on their own sync entity, so the client
 * attributes wishes from the member store it already holds and never keeps
 * a stale name inside a wish. A wish has no states beyond open and
 * received — removal is a true delete, and the tombstone the removal
 * writes carries it out of every device's copy.
 */

export const WISH_TITLE_MAX_LENGTH = 200
export const WISH_DETAILS_MAX_LENGTH = 2_000
export const WISH_LINK_MAX_LENGTH = 2_048

/**
 * PostgreSQL refuses NUL inside text, so the contracts refuse it at the
 * door: a payload that slips through would turn the write into a 500
 * instead of a validation answer.
 */
const titleSchema = Type.String({
  minLength: 1,
  maxLength: WISH_TITLE_MAX_LENGTH,
  pattern: '^[^\\u0000]*[^\\s\\u0000][^\\u0000]*$',
})

const detailsSchema = Type.Optional(
  Type.String({ maxLength: WISH_DETAILS_MAX_LENGTH, pattern: '^[^\\u0000]*$' }),
)

/**
 * The optional link must be an http(s) URL (issue #18): the pattern admits
 * only `http://` and `https://` followed by at least one non-whitespace
 * character, so `javascript:` and friends are a validation answer, never a
 * stored value.
 */
const linkSchema = Type.Optional(
  Type.String({
    maxLength: WISH_LINK_MAX_LENGTH,
    pattern: '^https?://[^\\s]+$',
  }),
)

/** The wishlist module's entity name in the tombstone table. */
export const WISHLIST_WISH_SYNC_ENTITY = 'wishlist_wish'

export const WishIdParamsSchema = Type.Object({
  wishId: Type.String({ format: 'uuid' }),
})

/** The optional per-author filter of the space-wide browse. */
export const WishListQuerySchema = Type.Object({
  author: Type.Optional(Type.String({ format: 'uuid' })),
})

export const WishDtoSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    authorId: Type.String({ format: 'uuid' }),
    title: Type.String(),
    details: Type.Optional(Type.String()),
    link: Type.Optional(Type.String()),
    // Set when the author marked the wish received; its absence means open.
    receivedAt: Type.Optional(Type.String({ format: 'date-time' })),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)

export type WishDto = Static<typeof WishDtoSchema>

/**
 * Projects the wish row onto the wire shape the reads and sync share.
 * Nulls disappear: an absent details, link, or receivedAt is the wire's
 * way to say "none".
 */
export function toWishDto(wish: Wish): WishDto {
  return {
    id: wish.id,
    authorId: wish.authorMemberId,
    title: wish.title,
    details: wish.details ?? undefined,
    link: wish.link ?? undefined,
    receivedAt: wish.receivedAt?.toISOString(),
    createdAt: wish.createdAt.toISOString(),
    updatedAt: wish.updatedAt.toISOString(),
  }
}

/**
 * Creating and editing carry the same whole triple (title, details, link):
 * the edit is a replace, so an absent details means "no details", never
 * "keep the old one" (the route ships with this module, so the verb is
 * chosen before anything depends on it). `receivedAt` is never an input
 * here — marking received is its own use case.
 */
export const WriteWishBodySchema = Type.Object(
  { title: titleSchema, details: detailsSchema, link: linkSchema },
  { additionalProperties: false },
)

export type WriteWishBody = Static<typeof WriteWishBodySchema>

export const WishListDtoSchema = Type.Object(
  { wishes: Type.Array(WishDtoSchema) },
  { additionalProperties: false },
)

export type WishListDto = Static<typeof WishListDtoSchema>

/** The wish's change in the sync response (issue #14, ADR-0014). */
export const WishSyncChangeSchema = Type.Object(
  { entity: Type.Literal('wishlist_wish'), wish: WishDtoSchema },
  { additionalProperties: false },
)
