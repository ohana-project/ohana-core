import { and, eq, or } from 'drizzle-orm'
import { DomainError } from '../../platform/errors.ts'
import { journalEntries } from './tables.ts'

/*
 * The journal's visibility and permission rules: the one place both the
 * ordinary reads and the sync contributor apply. A draft belongs to its
 * author alone; a published entry belongs to the whole space; a trashed
 * entry has left every ordinary view — the transaction that trashes it
 * writes the tombstones, and the trash view is its only audience (issue
 * #16, ADR-0007). The sync's SQL filter is the same rule in its one other
 * dialect, so a new state cannot make the two drift.
 */

/** A row the ordinary reads and sync may deliver: never a trashed one. */
export type DeliveredEntry = {
  state: 'draft' | 'published'
  authorMemberId: string
}

/**
 * What the requesting member may see of an entry. A draft is visible only
 * to its author, in reads and in sync alike; a published entry is visible
 * to every member of the space; a trashed entry is visible to nobody here.
 * True only for a non-trashed row, so reads may narrow the row's state
 * through the predicate — the wire contract of the ordinary reads never
 * carries `trashed`.
 */
export function entryVisibleTo(
  entry: { state: string; authorMemberId: string },
  memberId: string,
): entry is { state: 'draft' | 'published'; authorMemberId: string } {
  if (entry.state === 'published') return true
  return entry.state === 'draft' && entry.authorMemberId === memberId
}

/**
 * The same rule over the module's table, for the queries that must decide
 * visibility inside SQL (the sync contributor's delta). Kept next to
 * `entryVisibleTo` so what a member may see is defined in exactly one
 * place (architecture.md, "Sync contributors").
 */
export function entryVisibleToSql(memberId: string) {
  return or(
    eq(journalEntries.state, 'published'),
    and(eq(journalEntries.state, 'draft'), eq(journalEntries.authorMemberId, memberId)),
  )
}

/**
 * Who the trash view shows a trashed entry to: the author, whatever state
 * it was trashed from (a trashed draft stays visible only to its author —
 * CONTEXT.md, trashed entry), and every member when it was trashed from
 * published, the audience it already had.
 */
export function trashedEntryVisibleTo(
  entry: { authorMemberId: string; trashedFromState: string | null },
  memberId: string,
): boolean {
  return entry.trashedFromState === 'published' || entry.authorMemberId === memberId
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

/**
 * Who may trash what (issue #16, ADR-0007): the author their own entry,
 * whether draft or published; an owner any published entry — moderation.
 * An owner cannot trash another member's draft: the entry is not even
 * visible to them (the draft rule outranks the owner's moderation).
 */
export function assertEntryTrashableBy(
  entry: { authorMemberId: string; state: string },
  actor: { memberId: string; role: 'owner' | 'regular' },
): void {
  if (entry.authorMemberId === actor.memberId) return
  if (actor.role === 'owner' && entry.state === 'published') return
  throw new DomainError(
    'trash_forbidden',
    'Only the author — or, for a published entry, an owner — can trash it',
    403,
  )
}

/**
 * Who may restore what: the author their own entry, an owner any entry
 * trashed from published. The author alone restores a trashed draft, in
 * line with its visibility.
 */
export function assertTrashedEntryRestorableBy(
  entry: { authorMemberId: string; trashedFromState: string | null },
  actor: { memberId: string; role: 'owner' | 'regular' },
): void {
  if (entry.authorMemberId === actor.memberId) return
  if (actor.role === 'owner' && entry.trashedFromState === 'published') return
  throw new DomainError(
    'restore_forbidden',
    'Only the author — or, for an entry trashed from published, an owner — can restore it',
    403,
  )
}
