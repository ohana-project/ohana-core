import { DomainError } from '../../platform/errors.ts'

/*
 * The wishlist's visibility and permission rules: the one place both the
 * ordinary reads and the sync contributor apply. A wishlist is visible to
 * the other members of the space (CONTEXT.md, wishlist) — every wish of
 * the space is deliverable to every member, the space scoping of the
 * queries already applied, and received wishes travel the same way (the
 * "open wish" selection is the client's presentation over the same rows).
 * The author alone writes: edits, removals, and the received mark.
 */

/**
 * What the requesting member may see of a wish: everything in their space,
 * whoever wrote it. The rule is stated here so the module's one place for
 * "what a member may see" exists even while it is trivial (architecture.md,
 * "Sync contributors"); a future rule lands in this file and its SQL
 * dialect beside it.
 */
export function wishVisibleTo(): boolean {
  return true
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
