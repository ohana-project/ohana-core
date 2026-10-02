import { DomainError } from '../../platform/errors.ts'

/*
 * The calendar's visibility and permission rules (issue #20): the one
 * place the ordinary reads and the sync contributor apply. Every member of
 * the space sees every event — the calendar is the space's shared
 * schedule, so the only visibility scoping is the space itself, which the
 * space-scoped repositories and the section gate already apply.
 *
 * Changing an event follows the journal's moderation model (issue #16):
 * the creator may edit or delete their event, and an owner may edit or
 * delete anyone's — moderation of what the space shares. A regular member
 * cannot change another member's event, and the refusal is 403: an event
 * is visible to the whole space, so its existence is no secret to hide
 * behind a 404.
 */

/**
 * Only the event's creator — or, for anyone's event, an owner — may edit
 * or delete it (CONTEXT.md, calendar event; the journal's
 * `assertEntryTrashableBy` precedent). Owners do not become creators: the
 * event keeps the creator it was published under.
 */
export function assertEventEditableBy(
  event: { creatorMemberId: string },
  actor: { memberId: string; role: 'owner' | 'regular' },
): void {
  if (event.creatorMemberId === actor.memberId) return
  if (actor.role === 'owner') return
  throw new DomainError(
    'creator_required',
    'Only the creator of a calendar event — or an owner — can change or delete it',
    403,
  )
}
