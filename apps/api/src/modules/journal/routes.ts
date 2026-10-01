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
  CreateEntryBodySchema,
  EntryIdParamsSchema,
  FeedQuerySchema,
  JournalEntryDtoSchema,
  JournalFeedDtoSchema,
  toEntryDto,
  UpdateEntryBodySchema,
} from './contracts.ts'
import {
  createDraft,
  getEntry,
  type JournalActor,
  type JournalDeps,
  listDrafts,
  listFeed,
  publishDraft,
  updateEntryText,
} from './service.ts'

export interface JournalRoutesOptions {
  deps: JournalDeps
  /** The access module's deps, for the member session guard it publishes. */
  access: AccessDeps
}

/**
 * The journal's member-facing routes (issue #15). The section gate follows
 * the member session guard (ADR-0011): a hidden journal answers 404
 * `section_hidden` for every member before any handler runs, and the write
 * use cases recheck visibility inside their transactions.
 */
export const journalRoutes: FastifyPluginAsyncTypebox<JournalRoutesOptions> = async (app, opts) => {
  await app.register((memberArea: FastifyInstance) => {
    const scoped = memberArea.withTypeProvider<TypeBoxTypeProvider>()
    scoped.addHook('onRequest', memberSessionGuard(opts.access))
    scoped.addHook('onRequest', sectionGate({ db: opts.deps.db }, 'journal'))

    // The shared feed of published entries (issue #15): keyset-paginated,
    // newest first, with the author named on every row.
    scoped.get(
      '/journal/feed',
      {
        schema: {
          headers: MemberHeadersSchema,
          querystring: FeedQuerySchema,
          response: { 200: JournalFeedDtoSchema },
        },
      },
      async (request) => {
        const actor: JournalActor = requireMemberActor(request)
        const page = await listFeed(opts.deps, actor, request.query)
        return { entries: page.entries.map(toEntryDto), hasMore: page.hasMore }
      },
    )

    // The author's own drafts — the separate list only they see.
    scoped.get(
      '/journal/drafts',
      {
        schema: {
          headers: MemberHeadersSchema,
          response: { 200: Type.Array(JournalEntryDtoSchema) },
        },
      },
      async (request) => {
        const actor: JournalActor = requireMemberActor(request)
        return (await listDrafts(opts.deps, actor)).map(toEntryDto)
      },
    )

    scoped.post(
      '/journal/entries',
      {
        schema: {
          headers: MemberHeadersSchema,
          body: CreateEntryBodySchema,
          response: { 201: JournalEntryDtoSchema },
        },
      },
      async (request, reply) => {
        const actor: JournalActor = requireMemberActor(request)
        const entry = await createDraft(opts.deps, actor, request.body)
        return reply.code(201).send(toEntryDto(entry))
      },
    )

    scoped.get(
      '/journal/entries/:entryId',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: EntryIdParamsSchema,
          response: { 200: JournalEntryDtoSchema },
        },
      },
      async (request) => {
        const actor: JournalActor = requireMemberActor(request)
        return toEntryDto(await getEntry(opts.deps, actor, request.params.entryId))
      },
    )

    // The author's edit of a draft or a published entry — a PUT, because it
    // replaces the whole title-and-text pair (an absent title names "no
    // title", never "keep the old one"); the state is never an input here.
    scoped.put(
      '/journal/entries/:entryId',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: EntryIdParamsSchema,
          body: UpdateEntryBodySchema,
          response: { 200: JournalEntryDtoSchema },
        },
      },
      async (request) => {
        const actor: JournalActor = requireMemberActor(request)
        return toEntryDto(
          await updateEntryText(opts.deps, actor, request.params.entryId, request.body),
        )
      },
    )

    // The one-way transition draft → published.
    scoped.post(
      '/journal/entries/:entryId/publish',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: EntryIdParamsSchema,
          response: { 200: JournalEntryDtoSchema },
        },
      },
      async (request) => {
        const actor: JournalActor = requireMemberActor(request)
        return toEntryDto(await publishDraft(opts.deps, actor, request.params.entryId))
      },
    )
  })
}
