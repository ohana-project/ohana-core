/**
 * The wishlist module's public surface: what the composition root mounts
 * and wires — the member-facing routes and the sync contributor. All else
 * is the module's interior; tests import it directly.
 */

export { wishlistRoutes } from './routes.ts'
export { wishlistSyncContributor } from './sync.ts'
