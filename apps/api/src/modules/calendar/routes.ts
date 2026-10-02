import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import {
  type AccessDeps,
  MemberHeadersSchema,
  memberSessionGuard,
  requireMemberActor,
} from '../access/index.ts'
import { sectionGate } from '../spaces/index.ts'
import {
  CalendarEventDtoSchema,
  CreateEventBodySchema,
  EventIdParamsSchema,
  EventListDtoSchema,
  OccurrenceBodySchema,
  OccurrenceParamsSchema,
  toEventDto,
  UpdateEventBodySchema,
} from './contracts.ts'
import {
  type CalendarActor,
  type CalendarDeps,
  cancelOccurrence,
  createEvent,
  editEvent,
  editOccurrence,
  getEvent,
  listEvents,
  removeEvent,
} from './service.ts'

export interface CalendarRoutesOptions {
  deps: CalendarDeps
  /** The access module's deps, for the member session guard it publishes. */
  access: AccessDeps
}

/**
 * The calendar's member-facing routes (issues #20 and #21). The section
 * gate follows the member session guard (ADR-0011): a hidden calendar
 * answers 404 `section_hidden` for every member before any handler runs,
 * and the write use cases recheck visibility inside their transactions.
 *
 * The series and its occurrences share the event's URL: the event route is
 * the whole series' (a PUT there replaces the series definition), and the
 * occurrence routes name an original date under it — the change or
 * cancellation of one date of the series. "This and following" has no
 * route, by design (issue #21).
 */
export const calendarRoutes: FastifyPluginAsyncTypebox<CalendarRoutesOptions> = async (
  app,
  opts,
) => {
  await app.register(async (memberArea: FastifyInstance) => {
    const scoped = memberArea.withTypeProvider<TypeBoxTypeProvider>()
    scoped.addHook('onRequest', memberSessionGuard(opts.access))
    scoped.addHook('onRequest', sectionGate({ db: opts.deps.db }, 'calendar'))

    // The space's events (issue #20): every member's, creation order. The
    // synchronised partition is the screens' read; this route is the
    // contract the tests and the OpenAPI document speak.
    scoped.get(
      '/calendar/events',
      {
        schema: {
          headers: MemberHeadersSchema,
          response: { 200: EventListDtoSchema },
        },
      },
      async (request) => {
        const actor: CalendarActor = requireMemberActor(request)
        return {
          events: (await listEvents(opts.deps, actor)).map(({ event, exceptions, reminder }) =>
            toEventDto(event, exceptions, reminder),
          ),
        }
      },
    )

    scoped.post(
      '/calendar/events',
      {
        schema: {
          headers: MemberHeadersSchema,
          body: CreateEventBodySchema,
          response: { 201: CalendarEventDtoSchema },
        },
      },
      async (request, reply) => {
        const actor: CalendarActor = requireMemberActor(request)
        const { event, exceptions, reminder } = await createEvent(opts.deps, actor, request.body)
        return reply.code(201).send(toEventDto(event, exceptions, reminder))
      },
    )

    scoped.get(
      '/calendar/events/:eventId',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: EventIdParamsSchema,
          response: { 200: CalendarEventDtoSchema },
        },
      },
      async (request) => {
        const actor: CalendarActor = requireMemberActor(request)
        const { event, exceptions, reminder } = await getEvent(
          opts.deps,
          actor,
          request.params.eventId,
        )
        return toEventDto(event, exceptions, reminder)
      },
    )

    // The creator's or owner's edit of the whole series — a PUT, because it
    // replaces the whole event (the wishlist's precedent: an absent
    // timezone names the space's zone, never "keep the old one"; the same
    // replaces the recurrence).
    scoped.put(
      '/calendar/events/:eventId',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: EventIdParamsSchema,
          body: UpdateEventBodySchema,
          response: { 200: CalendarEventDtoSchema },
        },
      },
      async (request) => {
        const actor: CalendarActor = requireMemberActor(request)
        const { event, exceptions, reminder } = await editEvent(
          opts.deps,
          actor,
          request.params.eventId,
          request.body,
        )
        return toEventDto(event, exceptions, reminder)
      },
    )

    // One occurrence's replacement (issue #21): the answer is the whole
    // event, exceptions included — the exception travels inside it.
    scoped.put(
      '/calendar/events/:eventId/occurrences/:originalDate',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: OccurrenceParamsSchema,
          body: OccurrenceBodySchema,
          response: { 200: CalendarEventDtoSchema },
        },
      },
      async (request) => {
        const actor: CalendarActor = requireMemberActor(request)
        const { event, exceptions, reminder } = await editOccurrence(
          opts.deps,
          actor,
          request.params.eventId,
          request.params.originalDate,
          request.body,
        )
        return toEventDto(event, exceptions, reminder)
      },
    )

    // One occurrence cancelled (issue #21): the series skips the date.
    scoped.delete(
      '/calendar/events/:eventId/occurrences/:originalDate',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: OccurrenceParamsSchema,
          response: { 204: Type.Null() },
        },
      },
      async (request, reply) => {
        const actor: CalendarActor = requireMemberActor(request)
        await cancelOccurrence(
          opts.deps,
          actor,
          request.params.eventId,
          request.params.originalDate,
        )
        return reply.code(204).send(null)
      },
    )

    // The removal (issue #20): the event leaves for good, the tombstone
    // carrying it out of every device's copy.
    scoped.delete(
      '/calendar/events/:eventId',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: EventIdParamsSchema,
          response: { 204: Type.Null() },
        },
      },
      async (request, reply) => {
        const actor: CalendarActor = requireMemberActor(request)
        await removeEvent(opts.deps, actor, request.params.eventId)
        return reply.code(204).send(null)
      },
    )
  })
}
