import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyInstance } from 'fastify'
import { adminGuard } from '../../platform/http/adminGuard.ts'
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
  await app.register((admin: FastifyInstance) => {
    const scoped = admin.withTypeProvider<TypeBoxTypeProvider>()
    scoped.addHook('onRequest', adminGuard)
    scoped.post(
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
  })
}
