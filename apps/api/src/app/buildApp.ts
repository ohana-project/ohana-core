import cookie from '@fastify/cookie'
import swagger from '@fastify/swagger'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import Fastify, { type FastifyBaseLogger } from 'fastify'
import { adminRoutes } from '../modules/admin/routes.ts'
import { spacesRoutes } from '../modules/spaces/routes.ts'
import type { Clock } from '../platform/clock.ts'
import type { Db } from '../platform/db/index.ts'
import { healthRoutes } from '../platform/http/health.ts'
import { createSpaFallback, registerStaticFiles } from '../platform/http/staticFiles.ts'
import type { Logger } from '../platform/logging.ts'
import type { ObjectStorage } from '../platform/storage/index.ts'
import { registerErrorHandler } from './errorHandler.ts'

export interface AppDeps {
  db: Db
  storage: ObjectStorage
  clock: Clock
  logger: Logger
  webDist?: string
}

export function buildApp(deps: AppDeps) {
  const app = Fastify({
    loggerInstance: deps.logger as FastifyBaseLogger,
    ajv: { customOptions: { removeAdditional: false } },
  })

  registerErrorHandler(app, {
    spaFallback: deps.webDist === undefined ? undefined : createSpaFallback(deps.webDist),
  })

  app.register(swagger, {
    openapi: {
      info: {
        title: 'Ohana API',
        version: '0.1.0',
      },
    },
  })

  app.register(cookie)
  app.register(healthRoutes, { prefix: '/api', deps: { db: deps.db, storage: deps.storage } })
  app.register(spacesRoutes, { prefix: '/api/v1', deps: { db: deps.db, clock: deps.clock } })
  app.register(adminRoutes, { prefix: '/api/v1/admin', deps: { db: deps.db, clock: deps.clock } })
  if (deps.webDist !== undefined) {
    app.register(registerStaticFiles, { webDist: deps.webDist })
  }

  return app.withTypeProvider<TypeBoxTypeProvider>()
}
