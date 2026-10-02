import { DomainError } from '../../platform/errors.ts'

/*
 * The wishlist's visibility and permission rules: the one place both the
 * ordinary reads and the sync contributor apply. A wishlist is visible to
 * the other members of the space (CONTEXT.md, wishlist) — every wish of
 * the space is deliverable to every member, whoever wrote it, and received
 * wishes travel the same way (the "open wish" selection is the client's
 * presentation over the same rows). The author alone writes: edits,
 * removals, and the received mark.
 */

/**
 * What the requesting member may see of a wish: everything in their space,
 * whoever wrote it. True today, but stated here so the module's one place
 * for "what a member may see" exists and the reads go through it — a
 * future rule lands in this file and its SQL dialect beside it, and every
 * read and the sync contributor follow (architecture.md, "Sync
 * contributors") — issue #19 adds gift favorites and gift reservations,
 * whose own visibility rules land here beside this one. The space scoping
 * of the queries is applied before this rule; it is not repeated here.
 */
export function wishVisibleTo(_wish: { authorMemberId: string }, _memberId: string): boolean {
  return true
}

/**
 * The same rule over the module's table, for the queries that must decide
 * visibility inside SQL (the browse and the sync contributor's delta).
 * Kept next to `wishVisibleTo` so what a member may see is defined in
 * exactly one place. Today it narrows nothing: `undefined` in a drizzle
 * `and(...)` is no extra filter beyond the space scope the query already
 * carries — the `memberId` rides along because issue #19's favorites and
 * reservations bring visibility rules of their own, which land here as
 * real filters beside this one.
 */
export function wishVisibleToSql(_memberId: string): undefined {
  return undefined
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
