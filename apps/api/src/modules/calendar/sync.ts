import { getSpaceInTx, sectionVisibility } from '../spaces/index.ts'
import type { SyncContributor } from '../sync/index.ts'
import {
  CALENDAR_EVENT_SYNC_ENTITY,
  CalendarEventSyncChangeSchema,
  toEventDto,
} from './contracts.ts'
import { listChangedEventsFor } from './service.ts'

/** The calendar module's entity name in the tombstone table (contracts.ts owns the name). */
export { CALENDAR_EVENT_SYNC_ENTITY }

/*
 * The calendar sync contributor (issue #20): every event of the space the
 * requesting member belongs to, changed after the cursor — the calendar is
 * the space's shared schedule, so the policy's only filter is the space
 * itself (policy.ts). A hidden calendar section contributes nothing
 * (ADR-0011): the sections map travels on the space row, the client drops
 * the section's rows when it applies the map, and a re-shown section
 * resyncs from revision 0 once (architecture.md, "Visibility changes").
 *
 * The contributor satisfies the sync module's SyncContributor structurally,
 * where the composition root wires it; the upserts are typed against the
 * module's own change schema, so a drifting shape fails to compile here.
 */
export const calendarSyncContributor = {
  changeSchema: CalendarEventSyncChangeSchema,
  entities: [CALENDAR_EVENT_SYNC_ENTITY],
  changesSince: async (tx, actor, since) => {
    const space = await getSpaceInTx(tx, actor.spaceId)
    if (!sectionVisibility(space).calendar) {
      return { upserts: [] }
    }
    const changed = await listChangedEventsFor(tx, actor, since)
    return {
      upserts: changed.map(({ event, exceptions }) => ({
        entity: CALENDAR_EVENT_SYNC_ENTITY,
        event: toEventDto(event, exceptions),
      })),
    }
  },
} satisfies SyncContributor<typeof CalendarEventSyncChangeSchema>
