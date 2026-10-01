/**
 * The journal module's public surface (architecture.md, "Layout"):
 * `index.ts` exports what other modules mount — the member-facing routes
 * and the sync contributor the composition root wires. Everything else is
 * the module's interior; tests import it directly.
 */
export { journalRoutes } from './routes.ts'
export { journalSyncContributor } from './sync.ts'
