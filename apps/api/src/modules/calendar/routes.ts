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
  toEventDto,
  UpdateEventBodySchema,
} from './contracts.ts'
import {
  createEvent,
  type CalendarActor,
  type CalendarDeps,
  editEvent,
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
 * The calendar's member-facing routes (issue #20). The section gate follows
 * the member session guard (ADR-0011): a hidden calendar answers 404
 * `section_hidden` for every member before any handler runs, and the write
 * use cases recheck visibility inside their transactions.
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
        return { events: (await listEvents(opts.deps, actor)).map(toEventDto) }
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
        const event = await createEvent(opts.deps, actor, request.body)
        return reply.code(201).send(toEventDto(event))
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
        return toEventDto(await getEvent(opts.deps, actor, request.params.eventId))
      },
    )

    // The creator's or owner's edit — a PUT, because it replaces the whole
    // event (the wishlist's precedent: an absent timezone names the space's
    // zone, never "keep the old one").
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
        return toEventDto(
          await editEvent(opts.deps, actor, request.params.eventId, request.body),
        )
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
