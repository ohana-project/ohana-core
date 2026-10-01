import { DomainError } from '../../platform/errors.ts'
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
 * answers 404 by the convention for resources the actor cannot see
 * (architecture.md, "Errors"); the `section_hidden` code tells the client
 * why, so it can drop the section from its navigation.
 */
export function assertSectionVisible(space: Space, section: SectionId): void {
  if (!sectionVisibility(space)[section]) {
    throw new DomainError('section_hidden', `The ${section} section is hidden in this space`, 404)
  }
}
