import type { paths } from '@ohana/api-client'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { ApiError, assertOk } from '@/data/api-error.ts'
import { triggerSync } from '@/data/sync-engine.ts'
import { sectionDownloaded, useSyncedSpace } from '@/features/member/use-synced-space.ts'

/*
 * The calendar's server data (issue #20): reads of synchronised data come
 * from the member's synchronised partition — the same answer online and
 * offline (ADR-0002) — and the mutations go to the API through the
 * generated client. A success triggers a sync, and so does every refusal:
 * the calendar screens read the refused row or map from the local store,
 * so the sync is what corrects it (architecture.md, web rules) —
 * creator_required names a stale row, section_hidden a stale map.
 */

export type CalendarEventDto =
  paths['/api/v1/calendar/events']['post']['responses'][201]['content']['application/json']

/** The editor's input, in the wall-time form the API composes instants from. */
export interface EventInput {
  title: string
  allDay: boolean
  date: string
  startTime?: string
  endTime?: string
  timezone?: string
}

/**
 * The synchronised events and profiles the calendar screens read, plus
 * whether the device may claim calendar data at all: while the calendar is
 * the section a replay promise names (a re-show or the store upgrade,
 * ADR-0014), the store may hold only a fraction of it, and "empty" would
 * be a claim the device cannot make.
 */
export function useCalendarData() {
  const snapshot = useSyncedSpace()
  const events = snapshot.data?.events ?? []
  const profiles = snapshot.data?.members ?? []
  const space = snapshot.data?.space
  const downloaded = sectionDownloaded(snapshot.data, 'calendar')
  return { snapshot, events, profiles, space, downloaded }
}

/** POST /api/v1/calendar/events — a new event on the space's calendar. */
export function useCreateEvent() {
  return useMutation({
    mutationFn: async (input: EventInput): Promise<CalendarEventDto> => {
      const response = await api.POST('/api/v1/calendar/events', { body: eventBody(input) })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    onSuccess: () => void triggerSync(),
    onError: () => void triggerSync(),
  })
}

/** PUT /api/v1/calendar/events/{eventId} — the creator's or owner's edit, a whole replace. */
export function useUpdateEvent() {
  return useMutation({
    mutationFn: async (input: { eventId: string } & EventInput): Promise<CalendarEventDto> => {
      const response = await api.PUT('/api/v1/calendar/events/{eventId}', {
        params: { path: { eventId: input.eventId } },
        body: eventBody(input),
      })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    onSuccess: () => void triggerSync(),
    onError: () => void triggerSync(),
  })
}

/**
 * The wire's two-kind shape: the all-day kind carries no time at all, the
 * timed kind its wall time and zone. The timed fields arrive filled — the
 * editor refuses a blank or backwards pair before calling — and the empty
 * strings below are type plumbing for the generated contract, never a
 * sent payload.
 */
function eventBody(input: EventInput) {
  if (input.allDay) {
    return { title: input.title, allDay: true as const, date: input.date }
  }
  return {
    title: input.title,
    allDay: false as const,
    date: input.date,
    startTime: input.startTime ?? '',
    endTime: input.endTime ?? '',
    ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
  }
}

/** DELETE /api/v1/calendar/events/{eventId} — the removal, a true delete. */
export function useDeleteEvent() {
  return useMutation({
    mutationFn: async (input: { eventId: string }): Promise<void> => {
      const response = await api.DELETE('/api/v1/calendar/events/{eventId}', {
        params: { path: { eventId: input.eventId } },
      })
      await assertOk(response)
    },
    onSuccess: () => void triggerSync(),
    onError: () => void triggerSync(),
  })
}

type CalendarErrorKey =
  | 'calendar.errors.event_not_found'
  | 'calendar.errors.creator_required'
  | 'calendar.errors.invalid_event_date'
  | 'calendar.errors.event_end_before_start'
  | 'calendar.errors.invalid_timezone'
  | 'calendar.errors.section_hidden'
  | 'calendar.errors.validation_failed'
  | 'calendar.errors.unexpected'

const calendarErrorKeys: Partial<Record<string, CalendarErrorKey>> = {
  event_not_found: 'calendar.errors.event_not_found',
  creator_required: 'calendar.errors.creator_required',
  invalid_event_date: 'calendar.errors.invalid_event_date',
  event_end_before_start: 'calendar.errors.event_end_before_start',
  invalid_timezone: 'calendar.errors.invalid_timezone',
  section_hidden: 'calendar.errors.section_hidden',
  validation_failed: 'calendar.errors.validation_failed',
}

/** Translates a stable API error code into the caller's locale. */
export function calendarErrorMessage(
  error: unknown,
  translate: (key: CalendarErrorKey) => string,
): string {
  if (error instanceof ApiError) {
    const key = calendarErrorKeys[error.code]
    if (key !== undefined) return translate(key)
  }
  return translate('calendar.errors.unexpected')
}
