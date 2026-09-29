import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import { sql } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import type { ObjectStorage } from '../storage/index.ts'

const checkState = Type.Union([Type.Literal('up'), Type.Literal('down')])

const healthResponse = Type.Object(
  {
    status: Type.Union([Type.Literal('ok'), Type.Literal('degraded')]),
    checks: Type.Object(
      {
        database: checkState,
        storage: checkState,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export interface HealthDeps {
  db: Db
  storage: ObjectStorage
}

export interface HealthReport {
  status: 'ok' | 'degraded'
  checks: { database: 'up' | 'down'; storage: 'up' | 'down' }
}

export async function checkHealth(deps: HealthDeps): Promise<HealthReport> {
  const [database, storage] = await Promise.allSettled([
    deps.db.execute(sql`select 1`),
    deps.storage.ping(),
  ])
  const checks = {
    database: database.status === 'fulfilled' ? ('up' as const) : ('down' as const),
    storage: storage.status === 'fulfilled' ? ('up' as const) : ('down' as const),
  }
  return { status: checks.database === 'up' && checks.storage === 'up' ? 'ok' : 'degraded', checks }
}

export const healthRoutes: FastifyPluginAsyncTypebox<{ deps: HealthDeps }> = async (app, opts) => {
  app.get(
    '/health',
    { schema: { response: { 200: healthResponse, 503: healthResponse } } },
    async (_request, reply) => {
      const report = await checkHealth(opts.deps)
      return reply.code(report.status === 'ok' ? 200 : 503).send(report)
    },
  )
}
