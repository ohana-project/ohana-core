import { type Static, Type } from '@sinclair/typebox'
import type { GiftFavorite, GiftReservation, Wish } from './tables.ts'

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
 * only `http://` and `https://` followed by at least one character that is
 * neither whitespace nor NUL — `javascript:` and friends are a validation
 * answer, never a stored value, and the NUL the database refuses inside
 * text turns into a 500 when it slips through.
 */
const linkSchema = Type.Optional(
  Type.String({
    maxLength: WISH_LINK_MAX_LENGTH,
    pattern: '^https?://[^\\s\\u0000]+$',
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

/*
 * The gift favorite (issue #19): a member's private bookmark of someone
 * else's wish. The wire shape names the wish by id — the wish itself
 * travels on its own entity to every member, so the client renders the
 * favorite from the wish its store already holds, and a favorite whose
 * wish is gone is gone with it (the wish's removal deletes the favorite
 * in the same transaction). No state, no details of its own.
 */
export const WISHLIST_GIFT_FAVORITE_SYNC_ENTITY = 'wishlist_gift_favorite'

export const GiftFavoriteDtoSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    wishId: Type.String({ format: 'uuid' }),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)

export type GiftFavoriteDto = Static<typeof GiftFavoriteDtoSchema>

export function toGiftFavoriteDto(favorite: GiftFavorite): GiftFavoriteDto {
  return {
    id: favorite.id,
    wishId: favorite.wishId,
    createdAt: favorite.createdAt.toISOString(),
    updatedAt: favorite.updatedAt.toISOString(),
  }
}

/** The member's own favorites, the one listing that exists (policy.ts). */
export const GiftFavoriteListDtoSchema = Type.Object(
  { favorites: Type.Array(GiftFavoriteDtoSchema) },
  { additionalProperties: false },
)

export type GiftFavoriteListDto = Static<typeof GiftFavoriteListDtoSchema>

/** The favorite's change in the sync response — the owner's alone (issue #19). */
export const GiftFavoriteSyncChangeSchema = Type.Object(
  { entity: Type.Literal('wishlist_gift_favorite'), favorite: GiftFavoriteDtoSchema },
  { additionalProperties: false },
)

/*
 * The gift reservation (issue #19): a member's claim on a wish, visible to
 * every member except the wish's author, who never learns a reservation
 * exists — not the reservation, and not its ending. `memberId` is the
 * reserving member: "including who reserved" is the point, and the client
 * names them from the profiles its store already holds.
 */
export const WISHLIST_GIFT_RESERVATION_SYNC_ENTITY = 'wishlist_gift_reservation'

export const GiftReservationDtoSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    wishId: Type.String({ format: 'uuid' }),
    memberId: Type.String({ format: 'uuid' }),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)

export type GiftReservationDto = Static<typeof GiftReservationDtoSchema>

export function toGiftReservationDto(reservation: GiftReservation): GiftReservationDto {
  return {
    id: reservation.id,
    wishId: reservation.wishId,
    memberId: reservation.memberId,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
  }
}

/** The reservations the requesting member may see, wishes by others (policy.ts). */
export const GiftReservationListDtoSchema = Type.Object(
  { reservations: Type.Array(GiftReservationDtoSchema) },
  { additionalProperties: false },
)

export type GiftReservationListDto = Static<typeof GiftReservationListDtoSchema>

/** The reservation's change in the sync response — never the author's (issue #19). */
export const GiftReservationSyncChangeSchema = Type.Object(
  { entity: Type.Literal('wishlist_gift_reservation'), reservation: GiftReservationDtoSchema },
  { additionalProperties: false },
)

/**
 * The wishlist contributor's whole change vocabulary (issues #18 and #19):
 * the sync route composes the response union from the wired contributors,
 * and the contributor's upserts are typed against this union, so a
 * drifting shape fails to compile in sync.ts.
 */
export const WishlistSyncChangeSchema = Type.Union([
  WishSyncChangeSchema,
  GiftFavoriteSyncChangeSchema,
  GiftReservationSyncChangeSchema,
])
