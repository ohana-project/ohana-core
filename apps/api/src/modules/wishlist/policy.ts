import { eq, ne, notInArray, type SQL } from 'drizzle-orm'
import { DomainError } from '../../platform/errors.ts'
import { giftFavorites, wishes } from './tables.ts'

/*
 * The wishlist's visibility and permission rules: the one place both the
 * ordinary reads and the sync contributor apply. A wishlist is visible to
 * the other members of the space (CONTEXT.md, wishlist) — every wish of
 * the space is deliverable to every member, whoever wrote it, and received
 * wishes travel the same way (the "open wish" selection is the client's
 * presentation over the same rows). The author alone writes: edits,
 * removals, and the received mark. A gift favorite is private to the
 * member who made it, and a gift reservation is visible to every member
 * except the wish's author (issue #19, ADR-0001).
 */

/**
 * What the requesting member may see of a wish. Every wish of the space is
 * visible to every member — whoever wrote it — except the wishes of an
 * archived member (issue #23, CONTEXT.md, archived member): the wishes are
 * hidden from the space but kept, and come back when the member is
 * restored. `archivedMemberIds` is the space's archived set, read through
 * the members module's public surface; the caller reads it under the same
 * lock the read or write runs behind.
 */
export function wishVisibleTo(
  wish: { authorMemberId: string },
  _memberId: string,
  archivedMemberIds: readonly string[],
): boolean {
  return !archivedMemberIds.includes(wish.authorMemberId)
}

/**
 * The same rule over the module's table, for the queries that must decide
 * visibility inside SQL (the browse and the sync contributor's delta).
 * Kept next to `wishVisibleTo` so what a member may see is defined in
 * exactly one place. An empty archived set narrows nothing: `undefined` in
 * a drizzle `and(...)` is no extra filter beyond the space scope the query
 * already carries.
 */
export function wishVisibleToSql(
  _memberId: string,
  archivedMemberIds: readonly string[],
): SQL | undefined {
  if (archivedMemberIds.length === 0) return undefined
  return notInArray(wishes.authorMemberId, [...archivedMemberIds])
}

/**
 * Only the author edits, removes, or marks a wish received (issue #18) —
 * an owner moderates nothing here: a wish is personal, and no other
 * member's hand may move it.
 */
export function assertWishAuthoredBy(
  wish: { authorMemberId: string },
  actor: { memberId: string },
): void {
  if (wish.authorMemberId !== actor.memberId) {
    throw new DomainError('author_required', 'Only the author of a wish can change it', 403)
  }
}

/**
 * Nobody favorites or reserves their own wish (issue #19): a bookmark or a
 * claim is for giving to someone else. The two write paths answer with
 * their own stable code, so the caller names it; the rule itself is this
 * one comparison.
 */
export function assertWishNotAuthoredBy(
  wish: { authorMemberId: string },
  actor: { memberId: string },
  errorCode: string,
): void {
  if (wish.authorMemberId === actor.memberId) {
    throw new DomainError(errorCode, 'A member does not favorite or reserve their own wish', 403)
  }
}

/**
 * A gift favorite is visible to the member who made it alone (issue #19,
 * CONTEXT.md, gift favorite): other members never see it, and its
 * tombstones name that one member as their audience. The rule lives here
 * in its SQL dialect (architecture.md, "Sync contributors") because every
 * read of favorites — the own listing and the sync contributor's delta —
 * decides it inside SQL; a favorite row the member does not own never
 * reaches a service hand to compare.
 */
export function favoriteVisibleToSql(memberId: string): SQL {
  return eq(giftFavorites.memberId, memberId)
}

/**
 * A gift reservation is visible to every member except the wish's author
 * (issue #19, CONTEXT.md, gift reservation; ADR-0001: the surprise is
 * preserved) — and the author never learns of its ending either, which is
 * why the deletion's tombstones name every member but them, never `all`.
 */
export function reservationVisibleTo(
  reservation: { wishAuthorMemberId: string },
  memberId: string,
): boolean {
  return reservation.wishAuthorMemberId !== memberId
}

/**
 * The reservation rule in its SQL dialect, beside `reservationVisibleTo`:
 * every query that selects reservations joins the wish for its author, and
 * the visibility filter excludes the author's own rows. The space scoping
 * is applied before this rule; it is not repeated here.
 */
export function reservationVisibleToSql(memberId: string): SQL {
  return ne(wishes.authorMemberId, memberId)
}
