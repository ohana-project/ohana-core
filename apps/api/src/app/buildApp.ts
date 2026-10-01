import cookie from '@fastify/cookie'
import swagger from '@fastify/swagger'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import Fastify, { type FastifyBaseLogger } from 'fastify'
import {
  type AccessDeps,
  accessRoutes,
  memberSessionGuard,
  requireMemberActor,
  requireOwnerActor,
} from '../modules/access/index.ts'
import { adminRoutes } from '../modules/admin/routes.ts'
import {
  adminCountMembersBySpace,
  findMemberInSpace,
  membersSyncContributor,
} from '../modules/members/index.ts'
import { membersRoutes } from '../modules/members/routes.ts'
import { spacesSyncContributor } from '../modules/spaces/index.ts'
import { spacesRoutes } from '../modules/spaces/routes.ts'
import { syncRoutes } from '../modules/sync/index.ts'
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
  // The composition root is the one place allowed to know every module.
  // The access module sits below members, so the member lookups its service
  // and guard need arrive through this port; the members module sits above
  // access and receives the guard's deps back for its member-facing routes.
  const accessDeps: AccessDeps = {
    db: deps.db,
    clock: deps.clock,
    findMemberInSpace: (executor, spaceId, memberId) =>
      findMemberInSpace(executor, spaceId, memberId),
  }
  // The spaces listing needs the members module's administrative count, and
  // the members module sits above spaces, so the counter is injected here
  // instead of imported inside the spaces module. The member-facing space
  // routes mount the access module's guard the same way: access sits above
  // spaces, so the guard and its narrowings arrive through this port.
  app.register(spacesRoutes, {
    prefix: '/api/v1',
    deps: { db: deps.db, clock: deps.clock },
    countMembers: (db) => adminCountMembersBySpace({ db, clock: deps.clock }),
    memberArea: {
      guard: memberSessionGuard(accessDeps),
      requireMember: requireMemberActor,
      requireOwner: requireOwnerActor,
    },
  })
  app.register(accessRoutes, { prefix: '/api/v1', deps: accessDeps })
  app.register(membersRoutes, {
    prefix: '/api/v1',
    deps: { db: deps.db, clock: deps.clock },
    access: accessDeps,
  })
  // The sync module merges the contributors of every module with
  // synchronised data; spaces and members contribute today, the section
  // modules join when their data lands (architecture.md, "Sync
  // contributors").
  app.register(syncRoutes, {
    prefix: '/api/v1',
    deps: accessDeps,
    contributors: [spacesSyncContributor, membersSyncContributor],
  })
  app.register(adminRoutes, { prefix: '/api/v1/admin', deps: { db: deps.db, clock: deps.clock } })
  if (deps.webDist !== undefined) {
    app.register(registerStaticFiles, { webDist: deps.webDist })
  }

  return app.withTypeProvider<TypeBoxTypeProvider>()
}
