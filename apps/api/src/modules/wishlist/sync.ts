import type { Static } from '@sinclair/typebox'
import { getSpaceInTx, sectionVisibility } from '../spaces/index.ts'
import type { SyncContributor } from '../sync/index.ts'
import {
  type GiftFavoriteSyncChangeSchema,
  type GiftReservationSyncChangeSchema,
  toGiftFavoriteDto,
  toGiftReservationDto,
  toWishDto,
  WISHLIST_GIFT_FAVORITE_SYNC_ENTITY,
  WISHLIST_GIFT_RESERVATION_SYNC_ENTITY,
  WISHLIST_WISH_SYNC_ENTITY,
  WishlistSyncChangeSchema,
  type WishSyncChangeSchema,
} from './contracts.ts'
import {
  listChangedGiftFavorites,
  listChangedGiftReservations,
  listChangedWishes,
} from './service.ts'

/** The wishlist module's entity names in the tombstone table (contracts.ts owns them). */
export {
  WISHLIST_GIFT_FAVORITE_SYNC_ENTITY,
  WISHLIST_GIFT_RESERVATION_SYNC_ENTITY,
  WISHLIST_WISH_SYNC_ENTITY,
}

/*
 * The wishlist sync contributor (issues #14, #18, and #19): the wishes of
 * the space, the requesting member's own gift favorites, and the gift
 * reservations on wishes by others — each changed after the cursor. Every
 * wish travels to every member (policy.ts); a favorite travels to the
 * member who made it alone; a reservation travels to every member except
 * the wish's author, who must never learn a reservation exists — its
 * ending included, which is why the deletion's tombstones name every
 * member but the author, never `all` (service.ts). A hidden wishlist
 * section contributes nothing (ADR-0011): the sections map travels on the
 * space row, the client drops the section's rows when it applies the map,
 * and a re-shown section resyncs from revision 0 once (architecture.md,
 * "Visibility changes").
 *
 * The contributor satisfies the sync module's SyncContributor structurally,
 * where the composition root wires it; the upserts are typed against the
 * module's own change schema, so a drifting shape fails to compile here.
 */
export const wishlistSyncContributor = {
  changeSchema: WishlistSyncChangeSchema,
  entities: [
    WISHLIST_WISH_SYNC_ENTITY,
    WISHLIST_GIFT_FAVORITE_SYNC_ENTITY,
    WISHLIST_GIFT_RESERVATION_SYNC_ENTITY,
  ],
  changesSince: async (tx, actor, since) => {
    const space = await getSpaceInTx(tx, actor.spaceId)
    if (!sectionVisibility(space).wishlist) {
      return { upserts: [] }
    }
    const wishes = await listChangedWishes(tx, actor, since)
    const favorites = await listChangedGiftFavorites(tx, actor, since)
    const reservations = await listChangedGiftReservations(tx, actor, since)
    // Typed against the change schemas, so a shape drifting from the wire
    // contract fails to compile here rather than at the response.
    const upserts: Static<typeof WishlistSyncChangeSchema>[] = wishes.map(
      (wish): Static<typeof WishSyncChangeSchema> => ({
        entity: WISHLIST_WISH_SYNC_ENTITY,
        wish: toWishDto(wish),
      }),
    )
    upserts.push(
      ...favorites.map(
        (favorite): Static<typeof GiftFavoriteSyncChangeSchema> => ({
          entity: WISHLIST_GIFT_FAVORITE_SYNC_ENTITY,
          favorite: toGiftFavoriteDto(favorite),
        }),
      ),
      ...reservations.map(
        ({ reservation }): Static<typeof GiftReservationSyncChangeSchema> => ({
          entity: WISHLIST_GIFT_RESERVATION_SYNC_ENTITY,
          reservation: toGiftReservationDto(reservation),
        }),
      ),
    )
    return { upserts }
  },
} satisfies SyncContributor<typeof WishlistSyncChangeSchema>
