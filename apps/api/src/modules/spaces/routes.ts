import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { DomainError } from '../../platform/errors.ts'
import { AdminMarkerHeadersSchema, adminMarkerGuard, adminSessionGuard } from '../admin/index.ts'
import {
  CreateSpaceBodySchema,
  type MemberSpaceDto,
  MemberSpaceDtoSchema,
  type SpaceDto,
  SpaceDtoSchema,
  SpaceIdParamsSchema,
  SpaceMemberHeadersSchema,
  type SpaceWithMemberCountDto,
  SpaceWithMemberCountDtoSchema,
  UpdateMemberSpaceBodySchema,
  UpdateSpaceBodySchema,
} from './contracts.ts'
import { type SectionId, sectionVisibility } from './policy.ts'
import {
  createSpace,
  getSpace,
  listSpaces,
  requireVisibleSection,
  type SpaceMemberCounter,
  type SpacesDeps,
  type SpaceWithMemberCount,
  updateSpace,
} from './service.ts'
import type { Space } from './tables.ts'

/**
 * The one gate every section route mounts for its reads and writes
 * (ADR-0011): after the member session guard has attached the actor, the
 * gate asks the spaces service whether the actor's space shows the
 * section. The journal, calendar, and wishlist modules mount it; a
 * section route never rolls its own check.
 */
export function sectionGate(deps: SpacesDeps, section: SectionId) {
  return async (request: FastifyRequest): Promise<void> => {
    const actor = request.actor
    if (actor === undefined || actor.kind !== 'member') {
      throw new DomainError('unauthorized', 'A member session is required', 401)
    }
    await requireVisibleSection(deps, actor.spaceId, section)
  }
}

function toSpaceDto(space: Space): SpaceDto {
  return {
    id: space.id,
    name: space.name,
    timezone: space.timezone,
    revision: space.revision.toString(),
    createdAt: space.createdAt.toISOString(),
    updatedAt: space.updatedAt.toISOString(),
  }
}

function toMemberSpaceDto(space: Space): MemberSpaceDto {
  return {
    id: space.id,
    name: space.name,
    timezone: space.timezone,
    sections: sectionVisibility(space),
  }
}

function toSpaceWithMemberCountDto(space: SpaceWithMemberCount): SpaceWithMemberCountDto {
  return { ...toSpaceDto(space), memberCount: space.memberCount }
}

/*
 * The member actor the space routes read off the request, structural like
 * the request contract (architecture.md, request lifecycle). The access
 * module's guard produces it; spaces cannot import that module, because
 * access sits above spaces — so the shape is declared here and the guard
 * and narrowings are wired by the composition root, the way the member
 * counter is (architecture.md, "Composition").
 */
export interface SpaceMemberActor {
  kind: 'member'
  memberId: string
  spaceId: string
  role: 'owner' | 'regular'
  sessionId: string
}

/** The access module's memberSessionGuard, wired by the composition root. */
export type MemberSessionGuard = (request: FastifyRequest) => Promise<void>

export type MemberActorNarrowing = (request: FastifyRequest) => SpaceMemberActor

/** The guards and narrowings the member-facing space routes mount. */
export interface MemberAreaGuards {
  guard: MemberSessionGuard
  requireMember: MemberActorNarrowing
  requireOwner: MemberActorNarrowing
}

/**
 * The spaces module never imports the members or access modules (they sit
 * above it in the dependency order); the composition root injects the
 * member counter and the member-area guards when assembling the app.
 */
export interface SpacesRoutesOptions {
  deps: SpacesDeps
  countMembers: SpaceMemberCounter
  memberArea: MemberAreaGuards
}

export const spacesRoutes: FastifyPluginAsyncTypebox<SpacesRoutesOptions> = async (app, opts) => {
  await app.register((admin: FastifyInstance) => {
    const scoped = admin.withTypeProvider<TypeBoxTypeProvider>()
    scoped.addHook('onRequest', adminSessionGuard(opts.deps))
    scoped.addHook('onRequest', adminMarkerGuard)

    scoped.get(
      '/spaces',
      { schema: { response: { 200: Type.Array(SpaceWithMemberCountDtoSchema) } } },
      async () => {
        const rows = await listSpaces(opts.deps, opts.countMembers)
        return rows.map(toSpaceWithMemberCountDto)
      },
    )

    scoped.post(
      '/spaces',
      {
        schema: {
          body: CreateSpaceBodySchema,
          headers: AdminMarkerHeadersSchema,
          response: { 201: SpaceDtoSchema },
        },
      },
      async (request, reply) => {
        const space = await createSpace(opts.deps, request.body)
        return reply.code(201).send(toSpaceDto(space))
      },
    )

    scoped.get(
      '/spaces/:spaceId',
      { schema: { params: SpaceIdParamsSchema, response: { 200: SpaceDtoSchema } } },
      async (request) => toSpaceDto(await getSpace(opts.deps, request.params.spaceId)),
    )

    scoped.patch(
      '/spaces/:spaceId',
      {
        schema: {
          params: SpaceIdParamsSchema,
          body: UpdateSpaceBodySchema,
          headers: AdminMarkerHeadersSchema,
          response: { 200: SpaceDtoSchema },
        },
      },
      async (request) =>
        toSpaceDto(await updateSpace(opts.deps, request.params.spaceId, request.body)),
    )
  })

  // The member-facing space settings (issues #12 and #13): the actor's own
  // space, its default time zone and section visibility changeable by an
  // owner. Renaming stays with the instance administrator.
  await app.register((memberArea: FastifyInstance) => {
    const scoped = memberArea.withTypeProvider<TypeBoxTypeProvider>()
    scoped.addHook('onRequest', opts.memberArea.guard)

    scoped.get(
      '/space',
      {
        schema: {
          headers: SpaceMemberHeadersSchema,
          response: { 200: MemberSpaceDtoSchema },
        },
      },
      async (request) => {
        const actor = opts.memberArea.requireMember(request)
        return toMemberSpaceDto(await getSpace(opts.deps, actor.spaceId))
      },
    )

    scoped.patch(
      '/space',
      {
        schema: {
          headers: SpaceMemberHeadersSchema,
          body: UpdateMemberSpaceBodySchema,
          response: { 200: MemberSpaceDtoSchema },
        },
      },
      async (request) => {
        const actor = opts.memberArea.requireOwner(request)
        const space = await updateSpace(opts.deps, actor.spaceId, {
          timezone: request.body.timezone,
          sections: request.body.sections,
        })
        return toMemberSpaceDto(space)
      },
    )
  })
}
