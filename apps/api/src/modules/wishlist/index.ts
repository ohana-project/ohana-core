/**
 * The wishlist module's public surface: what the composition root mounts
 * and wires — the member-facing routes, the sync contributor, and the
 * member lifecycle's part (issue #23) the composition root wires into the
 * members module's port. All else is the module's interior; tests import
 * it directly.
 */

export { wishlistRoutes } from './routes.ts'
export { wishlistSyncContributor } from './sync.ts'
export {
  archiveWishlistOfMemberInTx,
  purgeGiftFavoritesOfMemberInTx,
  restampWishesOfMemberInTx,
} from './service.ts'
