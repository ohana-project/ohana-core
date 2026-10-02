import multipart from '@fastify/multipart'
import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import { DomainError } from '../../platform/errors.ts'
import {
  type AccessDeps,
  MemberHeadersSchema,
  memberSessionGuard,
  requireMemberActor,
} from '../access/index.ts'
import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  deleteEntryImage,
  EntryImageDtoSchema,
  type ImageAccessRule,
  type ImageAccessTxRule,
  type MediaDeps,
  readEntryImage,
  toImageDto,
  uploadEntryImage,
} from '../media/index.ts'
import { sectionGate } from '../spaces/index.ts'
import {
  CreateEntryBodySchema,
  EntryIdParamsSchema,
  FeedQuerySchema,
  ImageIdParamsSchema,
  ImageVariantParamsSchema,
  JournalEntryDtoSchema,
  JournalFeedDtoSchema,
  TrashedEntryDtoSchema,
  TrashListDtoSchema,
  toEntryDto,
  toTrashedEntryDto,
  UpdateEntryBodySchema,
} from './contracts.ts'
import {
  createDraft,
  getEntry,
  type JournalActor,
  type JournalDeps,
  listDrafts,
  listFeed,
  listTrash,
  publishDraft,
  restoreTrashedEntry,
  trashEntry,
  updateEntryText,
} from './service.ts'

export interface JournalRoutesOptions {
  deps: JournalDeps
  /** The access module's deps, for the member session guard it publishes. */
  access: AccessDeps
  /**
   * The media module's photo engine (issue #17) and the upload limit, plus
   * the journal's own visibility rules wired in as the photo access checks:
   * a photo's permissions are its entry's, and the media module never
   * imports upward to learn them.
   */
  media: {
    deps: MediaDeps
    maxUploadBytes: number
    imageViewable: ImageAccessRule
    imageEditable: ImageAccessRule
    imageEditableInTx: ImageAccessTxRule
  }
}

/**
 * The journal's member-facing routes (issue #15). The section gate follows
 * the member session guard (ADR-0011): a hidden journal answers 404
 * `section_hidden` for every member before any handler runs, and the write
 * use cases recheck visibility inside their transactions.
 */
export const journalRoutes: FastifyPluginAsyncTypebox<JournalRoutesOptions> = async (app, opts) => {
  await app.register(async (memberArea: FastifyInstance) => {
    const scoped = memberArea.withTypeProvider<TypeBoxTypeProvider>()
    scoped.addHook('onRequest', memberSessionGuard(opts.access))
    scoped.addHook('onRequest', sectionGate({ db: opts.deps.db }, 'journal'))
    // The photo uploads are the one multipart surface (issue #17); the
    // parser is registered on this scope alone. The file size is left
    // uncapped here on purpose: busboy's own cap would silently truncate a
    // larger photo and store the crop — the configured limit is enforced
    // once, in the service, where the stream is counted and refused whole.
    await scoped.register(multipart, {
      limits: { files: 1, fileSize: Number.POSITIVE_INFINITY },
    })

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

    // The trash view (issue #16): the trashed entries this member may see,
    // each with its permanent-deletion date. Online-only — the entries have
    // left every device's synchronised partition (their tombstones saw to
    // that), so the view asks the server.
    scoped.get(
      '/journal/trash',
      {
        schema: {
          headers: MemberHeadersSchema,
          response: { 200: TrashListDtoSchema },
        },
      },
      async (request) => {
        const actor: JournalActor = requireMemberActor(request)
        const rows = await listTrash(opts.deps, actor)
        return { entries: rows.map(({ entry, purgeAt }) => toTrashedEntryDto(entry, purgeAt)) }
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

    // The removal into trash (issue #16): recoverable until the deletion
    // date the answer carries.
    scoped.post(
      '/journal/entries/:entryId/trash',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: EntryIdParamsSchema,
          response: { 200: TrashedEntryDtoSchema },
        },
      },
      async (request) => {
        const actor: JournalActor = requireMemberActor(request)
        const { entry, purgeAt } = await trashEntry(opts.deps, actor, request.params.entryId)
        return toTrashedEntryDto(entry, purgeAt)
      },
    )

    // The way back out: the entry returns to the state it was trashed from.
    scoped.post(
      '/journal/entries/:entryId/restore',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: EntryIdParamsSchema,
          response: { 200: JournalEntryDtoSchema },
        },
      },
      async (request) => {
        const actor: JournalActor = requireMemberActor(request)
        return toEntryDto(await restoreTrashedEntry(opts.deps, actor, request.params.entryId))
      },
    )

    /*
     * The photos (issue #17). The upload streams through the API into
     * storage behind the authorship check; the original's bytes are served
     * and kept exactly as they arrived (ADR-0008), and only the worker's
     * derivatives — never the original — are meant for caches and feeds.
     */
    scoped.post(
      '/journal/entries/:entryId/images',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: EntryIdParamsSchema,
          // One multipart part named "file"; the body itself is the parser's
          // stream, not a JSON schema's.
          consumes: ['multipart/form-data'],
          response: { 201: EntryImageDtoSchema },
        },
      },
      async (request, reply) => {
        const actor: JournalActor = requireMemberActor(request)
        const file = await request.file()
        if (file === undefined) {
          throw new DomainError(
            'image_required',
            'The upload must carry one photo in a "file" field',
            400,
          )
        }
        const image = await uploadEntryImage(
          opts.media.deps,
          actor,
          request.params.entryId,
          { stream: file.file, contentType: file.mimetype },
          {
            authorize: opts.media.imageEditable,
            authorizeInTx: opts.media.imageEditableInTx,
            maxBytes: opts.media.maxUploadBytes,
          },
        )
        return reply.code(201).send(toImageDto(image))
      },
    )

    scoped.get(
      '/journal/entries/:entryId/images/:imageId/variants/:variant',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: ImageVariantParamsSchema,
          // The answer is the photo's bytes, streamed from storage — no
          // JSON schema stands between (binary responses are the one
          // exception to the serialisation rule).
          produces: [...ALLOWED_IMAGE_CONTENT_TYPES, 'image/webp'],
        },
      },
      async (request, reply) => {
        const actor: JournalActor = requireMemberActor(request)
        const stored = await readEntryImage(
          opts.media.deps,
          actor,
          request.params.entryId,
          request.params.imageId,
          request.params.variant,
          { authorize: opts.media.imageViewable },
        )
        return (
          reply
            .header('content-type', stored.contentType)
            .header('content-length', stored.size)
            // The bytes are exactly the type the row names: no sniffing, and
            // nothing sits in the browser's HTTP cache — a shared cache on
            // this device would answer after a sign-out, a trash, or a
            // hidden section without reaching the API. Offline previews are
            // the service worker's job: its CacheFirst rule stores the
            // response regardless, and its cache dies with the session.
            .header('x-content-type-options', 'nosniff')
            .header('cache-control', 'private, no-store')
            .send(stored.stream)
        )
      },
    )

    scoped.delete(
      '/journal/entries/:entryId/images/:imageId',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: ImageIdParamsSchema,
          response: { 204: Type.Null() },
        },
      },
      async (request, reply) => {
        const actor: JournalActor = requireMemberActor(request)
        await deleteEntryImage(
          opts.media.deps,
          actor,
          request.params.entryId,
          request.params.imageId,
          {
            authorizeInTx: opts.media.imageEditableInTx,
          },
        )
        return reply.code(204).send(null)
      },
    )
  })
}
