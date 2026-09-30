import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import { AdminMarkerHeadersSchema, adminMarkerGuard, adminSessionGuard } from '../admin/index.ts'
import {
  ChangeMemberRoleBodySchema,
  type MemberDto,
  MemberDtoSchema,
  MemberParamsSchema,
  ProvisionMemberBodySchema,
  SpaceIdParamsSchema,
} from './contracts.ts'
import { changeMemberRole, listMembers, type MembersDeps, provisionMember } from './service.ts'
import type { Member } from './tables.ts'

function toMemberDto(member: Member): MemberDto {
  return {
    id: member.id,
    spaceId: member.spaceId,
    name: member.name,
    displayName: member.displayName ?? undefined,
    email: member.email ?? undefined,
    phone: member.phone ?? undefined,
    interfaceLanguage:
      member.interfaceLanguage === 'ru' || member.interfaceLanguage === 'en'
        ? member.interfaceLanguage
        : undefined,
    role: member.role as 'owner' | 'regular',
    revision: member.revision.toString(),
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
  }
}

export interface MembersRoutesOptions {
  deps: MembersDeps
}

export const membersRoutes: FastifyPluginAsyncTypebox<MembersRoutesOptions> = async (app, opts) => {
  await app.register((admin: FastifyInstance) => {
    const scoped = admin.withTypeProvider<TypeBoxTypeProvider>()
    scoped.addHook('onRequest', adminSessionGuard(opts.deps))
    scoped.addHook('onRequest', adminMarkerGuard)

    scoped.get(
      '/spaces/:spaceId/members',
      {
        schema: {
          params: SpaceIdParamsSchema,
          response: { 200: Type.Array(MemberDtoSchema) },
        },
      },
      async (request) => {
        const { spaceId } = request.params
        const rows = await listMembers(opts.deps, spaceId)
        return rows.map(toMemberDto)
      },
    )

    scoped.post(
      '/spaces/:spaceId/members',
      {
        schema: {
          params: SpaceIdParamsSchema,
          body: ProvisionMemberBodySchema,
          headers: AdminMarkerHeadersSchema,
          response: { 201: MemberDtoSchema },
        },
      },
      async (request, reply) => {
        const { spaceId } = request.params
        const member = await provisionMember(opts.deps, spaceId, request.body)
        return reply.code(201).send(toMemberDto(member))
      },
    )

    scoped.patch(
      '/spaces/:spaceId/members/:memberId',
      {
        schema: {
          params: MemberParamsSchema,
          body: ChangeMemberRoleBodySchema,
          headers: AdminMarkerHeadersSchema,
          response: { 200: MemberDtoSchema },
        },
      },
      async (request) => {
        const { spaceId, memberId } = request.params
        const member = await changeMemberRole(opts.deps, spaceId, memberId, request.body.role)
        return toMemberDto(member)
      },
    )
  })
}
