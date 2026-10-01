import { eq, or } from 'drizzle-orm'
import { DomainError } from '../../platform/errors.ts'
import { journalEntries } from './tables.ts'

/*
 * The journal's visibility and permission rules (issue #15): the one place
 * both the ordinary reads and the sync contributor apply. A draft belongs
 * to its author alone; a published entry belongs to the whole space. The
 * sync's SQL filter is the same rule in its one other dialect, so a new
 * state cannot make the two drift.
 */

/**
 * What the requesting member may see of an entry. A draft is visible only
 * to its author, in reads and in sync alike; a published entry is visible
 * to every member of the space.
 */
export function entryVisibleTo(
  entry: { state: string; authorMemberId: string },
  memberId: string,
): boolean {
  return entry.state === 'published' || entry.authorMemberId === memberId
}

/**
 * The same rule over the module's table, for the queries that must decide
 * visibility inside SQL (the sync contributor's delta). Kept next to
 * `entryVisibleTo` so what a member may see is defined in exactly one
 * place (architecture.md, "Sync contributors").
 */
export function entryVisibleToSql(memberId: string) {
  return or(eq(journalEntries.state, 'published'), eq(journalEntries.authorMemberId, memberId))
}

/**
 * Only the author edits an entry, in any state (CONTEXT.md, published
 * entry) — an owner moderates, but never writes under another member's
 * name. The entry is visible to the actor here (a draft would have been
 * refused as unseen already), so the refusal says so plainly.
 */
export function assertEntryAuthoredBy(
  entry: { authorMemberId: string },
  actor: { memberId: string },
): void {
  if (entry.authorMemberId !== actor.memberId) {
    throw new DomainError(
      'author_required',
      'Only the author of a journal entry can change it',
      403,
    )
  }
}
