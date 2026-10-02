import { getSpaceInTx, sectionVisibility } from '../spaces/index.ts'
import type { SyncContributor } from '../sync/index.ts'
import { toWishDto, WISHLIST_WISH_SYNC_ENTITY, WishSyncChangeSchema } from './contracts.ts'
import { listChangedWishes } from './service.ts'

/** The wishlist module's entity name in the tombstone table (contracts.ts owns the name). */
export { WISHLIST_WISH_SYNC_ENTITY }

/*
 * The wishlist sync contributor (issues #14 and #18): the wishes of the
 * space, changed after the cursor. Every wish travels to every member
 * (policy.ts) — a wishlist is visible to the other members of the space,
 * and received wishes ride the same delivery. A hidden wishlist section
 * contributes nothing (ADR-0011): the sections map travels on the space
 * row, the client drops the section's rows when it applies the map, and a
 * re-shown section resyncs from revision 0 once (architecture.md,
 * "Visibility changes").
 *
 * The contributor satisfies the sync module's SyncContributor structurally,
 * where the composition root wires it; the upserts are typed against the
 * module's own change schema, so a drifting shape fails to compile here.
 */
export const wishlistSyncContributor = {
  changeSchema: WishSyncChangeSchema,
  entities: [WISHLIST_WISH_SYNC_ENTITY],
  changesSince: async (tx, actor, since) => {
    const space = await getSpaceInTx(tx, actor.spaceId)
    if (!sectionVisibility(space).wishlist) {
      return { upserts: [] }
    }
    const rows = await listChangedWishes(tx, actor.spaceId, since)
    return {
      upserts: rows.map((wish) => ({
        entity: WISHLIST_WISH_SYNC_ENTITY,
        wish: toWishDto(wish),
      })),
    }
  },
} satisfies SyncContributor<typeof WishSyncChangeSchema>
