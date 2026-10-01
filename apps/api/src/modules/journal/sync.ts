import { getSpaceInTx, sectionVisibility } from '../spaces/index.ts'
import type { SyncContributor } from '../sync/index.ts'
import { JournalEntrySyncChangeSchema, toEntryDto } from './contracts.ts'
import { listChangedEntriesFor } from './service.ts'

/** The journal module's entity name in the tombstone table. */
export const JOURNAL_ENTRY_SYNC_ENTITY = 'journal_entry'

/*
 * The journal sync contributor (issues #14 and #15): the entries the
 * requesting member may see, changed after the cursor. The policy is the
 * ordinary read's (policy.ts): published entries travel to every member,
 * a draft only to its author — another member's draft never leaves the
 * server. A hidden journal section contributes nothing (ADR-0011): the
 * sections map travels on the space row, the client drops the section's
 * rows when it applies the map, and a re-shown section resyncs from
 * revision 0 once (architecture.md, "Visibility changes").
 *
 * The contributor satisfies the sync module's SyncContributor structurally,
 * where the composition root wires it; the upserts are typed against the
 * module's own change schema, so a drifting shape fails to compile here.
 */
export const journalSyncContributor = {
  changeSchema: JournalEntrySyncChangeSchema,
  entities: [JOURNAL_ENTRY_SYNC_ENTITY],
  changesSince: async (tx, actor, since) => {
    const space = await getSpaceInTx(tx, actor.spaceId)
    if (!sectionVisibility(space).journal) {
      return { upserts: [] }
    }
    const rows = await listChangedEntriesFor(tx, actor, since)
    return {
      upserts: rows.map((entry) => ({
        entity: JOURNAL_ENTRY_SYNC_ENTITY,
        entry: toEntryDto(entry),
      })),
    }
  },
} satisfies SyncContributor<typeof JournalEntrySyncChangeSchema>
