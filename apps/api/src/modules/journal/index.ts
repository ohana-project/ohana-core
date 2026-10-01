/**
 * The journal module's public surface: what the composition root mounts
 * and wires — the member-facing routes and the sync contributor. Everything
 * else is the module's interior; tests import it directly.
 */
export { journalRoutes } from './routes.ts'
export { journalSyncContributor } from './sync.ts'
