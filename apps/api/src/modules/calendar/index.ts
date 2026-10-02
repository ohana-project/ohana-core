/**
 * The calendar module's public surface: what the composition root mounts
 * and wires — the member-facing routes and the sync contributor (issue
 * #20). All else is the module's interior; tests import it directly.
 */

export { calendarRoutes } from './routes.ts'
export { calendarSyncContributor, CALENDAR_EVENT_SYNC_ENTITY } from './sync.ts'
