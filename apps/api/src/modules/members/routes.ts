import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import {
  type AccessDeps,
  MemberHeadersSchema,
  memberSessionGuard,
  requireMemberActor,
  requireOwnerActor,
} from '../access/index.ts'
import { AdminMarkerHeadersSchema, adminMarkerGuard, adminSessionGuard } from '../admin/index.ts'
import {
  ChangeMemberRoleBodySchema,
  type Me,
  type MemberDto,
  MemberDtoSchema,
  MemberIdParamsSchema,
  MemberParamsSchema,
  type MemberProfileDto,
  MemberProfileDtoSchema,
  MeSchema,
  OnboardingBodySchema,
  ProvisionMemberBodySchema,
  SpaceIdParamsSchema,
} from './contracts.ts'
import {
  changeMemberRole,
  completeOnboarding,
  describeMember,
  listMembers,
  type MembersDeps,
  provisionMember,
} from './service.ts'
import type { Member } from './tables.ts'

function toMemberDto(member: Member): MemberDto {
  return {
    id: member.id,
    spaceId: member.spaceId,
    name: member.name,
    displayName: member.displayName ?? undefined,
    email: member.email ?? undefined,
    phone: member.phone ?? undefined,
    interfaceLanguage: member.interfaceLanguage ?? undefined,
    role: member.role,
    revision: member.revision.toString(),
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
  }
}

function toMemberProfileDto(member: Member): MemberProfileDto {
  return {
    id: member.id,
    name: member.name,
    displayName: member.displayName ?? undefined,
    email: member.email ?? undefined,
    phone: member.phone ?? undefined,
    interfaceLanguage: member.interfaceLanguage ?? undefined,
    role: member.role,
    createdAt: member.createdAt.toISOString(),
  }
}

function toMe(member: Member, spaceId: string, spaceName: string): Me {
  return {
    member: toMemberProfileDto(member),
    space: { id: spaceId, name: spaceName },
    // A member that has not completed onboarding goes there first.
    needsOnboarding: member.onboardedAt === null,
  }
}

export interface MembersRoutesOptions {
  deps: MembersDeps
  /** The access module's deps, for the member session guard it publishes. */
  access: AccessDeps
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

  // Member-facing routes: the space always comes from the authenticated
  // actor, never from the URL or body (architecture.md, request lifecycle).
  await app.register((memberArea: FastifyInstance) => {
    const scoped = memberArea.withTypeProvider<TypeBoxTypeProvider>()
    scoped.addHook('onRequest', memberSessionGuard(opts.access))

    scoped.get(
      '/me',
      {
        schema: {
          headers: MemberHeadersSchema,
          response: { 200: MeSchema },
        },
      },
      async (request) => {
        const actor = requireMemberActor(request)
        const { member, spaceName } = await describeMember(opts.deps, actor)
        return toMe(member, actor.spaceId, spaceName)
      },
    )

    scoped.post(
      '/me/onboarding',
      {
        schema: {
          headers: MemberHeadersSchema,
          body: OnboardingBodySchema,
          response: { 200: MeSchema },
        },
      },
      async (request) => {
        const actor = requireMemberActor(request)
        await completeOnboarding(opts.deps, actor, request.body)
        const { member, spaceName } = await describeMember(opts.deps, actor)
        return toMe(member, actor.spaceId, spaceName)
      },
    )

    scoped.get(
      '/members',
      {
        schema: {
          headers: MemberHeadersSchema,
          response: { 200: Type.Array(MemberProfileDtoSchema) },
        },
      },
      async (request) => {
        const actor = requireMemberActor(request)
        const rows = await listMembers(opts.deps, actor.spaceId)
        return rows.map(toMemberProfileDto)
      },
    )

    // The owner's space management (issue #12, ADR-0005): provisioning and
    // role changes without the instance administrator. The target space is
    // the actor's own — an owner's authority ends at their space.
    scoped.post(
      '/members',
      {
        schema: {
          headers: MemberHeadersSchema,
          body: ProvisionMemberBodySchema,
          response: { 201: MemberProfileDtoSchema },
        },
      },
      async (request, reply) => {
        const actor = requireOwnerActor(request)
        const member = await provisionMember(opts.deps, actor.spaceId, request.body)
        return reply.code(201).send(toMemberProfileDto(member))
      },
    )

    scoped.patch(
      '/members/:memberId',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: MemberIdParamsSchema,
          body: ChangeMemberRoleBodySchema,
          response: { 200: MemberProfileDtoSchema },
        },
      },
      async (request) => {
        const actor = requireOwnerActor(request)
        const member = await changeMemberRole(
          opts.deps,
          actor.spaceId,
          request.params.memberId,
          request.body.role,
        )
        return toMemberProfileDto(member)
      },
    )
  })
}
