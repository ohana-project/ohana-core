import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import { AdminMarkerHeadersSchema, adminMarkerGuard, adminSessionGuard } from '../admin/index.ts'
import {
  CreateSpaceBodySchema,
  type SpaceDto,
  SpaceDtoSchema,
  SpaceIdParamsSchema,
  type SpaceWithMemberCountDto,
  SpaceWithMemberCountDtoSchema,
  UpdateSpaceBodySchema,
} from './contracts.ts'
import {
  createSpace,
  getSpace,
  listSpaces,
  type SpaceMemberCounter,
  type SpacesDeps,
  type SpaceWithMemberCount,
  updateSpace,
} from './service.ts'
import type { Space } from './tables.ts'

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

function toSpaceWithMemberCountDto(space: SpaceWithMemberCount): SpaceWithMemberCountDto {
  return { ...toSpaceDto(space), memberCount: space.memberCount }
}

/**
 * The spaces module never imports the members module (it sits below it in
 * the dependency order); the composition root injects the member counter
 * when assembling the app.
 */
export interface SpacesRoutesOptions {
  deps: SpacesDeps
  countMembers: SpaceMemberCounter
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
}
