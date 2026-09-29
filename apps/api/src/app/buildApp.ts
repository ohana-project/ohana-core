import swagger from '@fastify/swagger'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import Fastify, { type FastifyBaseLogger } from 'fastify'
import { spacesRoutes } from '../modules/spaces/routes.ts'
import type { Clock } from '../platform/clock.ts'
import type { Db } from '../platform/db/index.ts'
import { healthRoutes } from '../platform/http/health.ts'
import type { Logger } from '../platform/logging.ts'
import type { ObjectStorage } from '../platform/storage/index.ts'
import { registerErrorHandler } from './errorHandler.ts'

export interface AppDeps {
  db: Db
  storage: ObjectStorage
  clock: Clock
  logger: Logger
}

export function buildApp(deps: AppDeps) {
  const app = Fastify({
    loggerInstance: deps.logger as FastifyBaseLogger,
    ajv: { customOptions: { removeAdditional: false } },
  })

  registerErrorHandler(app)

  app.register(swagger, {
    openapi: {
      info: {
        title: 'Ohana API',
        version: '0.1.0',
      },
    },
  })

  app.register(healthRoutes, { prefix: '/api', deps: { db: deps.db, storage: deps.storage } })
  app.register(spacesRoutes, { prefix: '/api/v1', deps: { db: deps.db, clock: deps.clock } })

  return app.withTypeProvider<TypeBoxTypeProvider>()
}
