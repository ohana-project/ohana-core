import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyInstance } from 'fastify'
import {
  type AccessDeps,
  MemberHeadersSchema,
  memberSessionGuard,
  requireMemberActor,
} from '../access/index.ts'
import { SyncQuerySchema, SyncResponseSchema } from './contracts.ts'
import { type SyncContributor, syncSince } from './service.ts'

export interface SyncRoutesOptions {
  /** The access module's deps, for the member session guard it publishes. */
  deps: AccessDeps
  /**
   * The contributors the composition root merges (architecture.md, "Sync
   * contributors"): spaces and members today, the section modules as their
   * data lands.
   */
  contributors: readonly SyncContributor[]
}

/**
 * The delta-sync endpoint (issue #14, ADR-0014): one member-scoped read,
 * answered from the contributors the composition root wires in.
 */
export const syncRoutes: FastifyPluginAsyncTypebox<SyncRoutesOptions> = async (app, opts) => {
  const scoped = (inner: FastifyInstance) => {
    const typed = inner.withTypeProvider<TypeBoxTypeProvider>()
    typed.addHook('onRequest', memberSessionGuard(opts.deps))

    typed.get(
      '/sync',
      {
        schema: {
          headers: MemberHeadersSchema,
          querystring: SyncQuerySchema,
          response: { 200: SyncResponseSchema },
        },
      },
      async (request) => {
        const actor = requireMemberActor(request)
        return syncSince(opts.deps.db, actor, BigInt(request.query.since), opts.contributors)
      },
    )
  }
  await scoped(app)
}
