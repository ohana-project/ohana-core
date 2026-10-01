import type { FastifyRequest } from 'fastify'
import type { Db } from '../../platform/db/index.ts'
import { DomainError } from '../../platform/errors.ts'
import { getSpaceById } from './repository.ts'
import type { Space } from './tables.ts'

/*
 * Section visibility policy (ADR-0011): which of the space's shared
 * sections appear to members. Hiding is an access and presentation
 * setting, never deletion — the sections' data stays.
 */

export const SECTION_IDS = ['journal', 'calendar', 'wishlist'] as const

export type SectionId = (typeof SECTION_IDS)[number]

export type SpaceSections = Record<SectionId, boolean>

/** The space row's section flags as the API and clients see them. */
export function sectionVisibility(space: Space): SpaceSections {
  return {
    journal: space.journalVisible,
    calendar: space.calendarVisible,
    wishlist: space.wishlistVisible,
  }
}

/**
 * The one rule every section read and write goes through. A hidden section
 * does not exist for the member: like any resource the actor cannot see,
 * it answers 404, not 403, so its state is not revealed.
 */
export function assertSectionVisible(space: Space, section: SectionId): void {
  if (!sectionVisibility(space)[section]) {
    throw new DomainError('section_hidden', `The ${section} section is hidden in this space`, 404)
  }
}

/*
 * The actor the gate reads off the request. The access module's member
 * session guard attaches it; spaces sits below access, so the shape is
 * declared structurally here, the way the route options do it
 * (architecture.md, "Composition").
 */
interface GatedMemberActor {
  kind: 'member'
  spaceId: string
}

export interface SectionGateDeps {
  db: Db
}

/**
 * The one gate every section route mounts for its reads and writes
 * (issue #13): after the member session guard has attached the actor, the
 * gate resolves the actor's space and refuses the request when the section
 * is hidden there. The journal, calendar, and wishlist modules mount it;
 * a section route never rolls its own check.
 */
export function sectionGate(deps: SectionGateDeps, section: SectionId) {
  return async (request: FastifyRequest): Promise<void> => {
    const actor = request.actor
    if (actor === undefined || actor.kind !== 'member') {
      throw new DomainError('unauthorized', 'A member session is required', 401)
    }
    const space = await getSpaceById(deps.db, (actor as GatedMemberActor).spaceId)
    if (space === undefined) {
      throw new DomainError('space_not_found', `Space ${actor.spaceId} does not exist`, 404)
    }
    assertSectionVisible(space, section)
  }
}
