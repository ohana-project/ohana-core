import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { CreateSpaceBodySchema, type SpaceDto, SpaceDtoSchema } from './contracts.ts'
import { createSpace, type SpacesDeps } from './service.ts'
import type { Space } from './tables.ts'

function toSpaceDto(space: Space): SpaceDto {
  return {
    id: space.id,
    name: space.name,
    revision: space.revision.toString(),
    createdAt: space.createdAt.toISOString(),
    updatedAt: space.updatedAt.toISOString(),
  }
}

export interface SpacesRoutesOptions {
  deps: SpacesDeps
}

export const spacesRoutes: FastifyPluginAsyncTypebox<SpacesRoutesOptions> = async (app, opts) => {
  app.post(
    '/spaces',
    {
      schema: {
        body: CreateSpaceBodySchema,
        response: { 201: SpaceDtoSchema },
      },
    },
    async (request, reply) => {
      const space = await createSpace(opts.deps, request.body)
      return reply.code(201).send(toSpaceDto(space))
    },
  )
}
