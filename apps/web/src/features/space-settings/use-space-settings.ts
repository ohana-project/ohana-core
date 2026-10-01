import type { paths } from '@ohana/api-client'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { ApiError, assertOk, extractErrorCode } from '@/data/api-error.ts'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { memberSessionQueryKey } from '@/features/member/use-member-session.ts'

/*
 * Owner space management (issue #12) is online-only data — no local store
 * yet; the sync engine arrives with its own ticket. Ordinary queries and
 * mutations over the generated client. The active member rides along as
 * X-Ohana-Member (data/api.ts); every key is member-scoped and the header
 * is pinned to that member, so a cached answer never surfaces for, or is
 * fetched under the name of, another member.
 */

/** GET /api/v1/space — the actor's own space with its default time zone. */
export type MemberSpace =
  paths['/api/v1/space']['get']['responses'][200]['content']['application/json']

/** The owner-provisioned member, shaped like the profiles list entry. */
export type ProvisionedMember =
  paths['/api/v1/members']['post']['responses'][201]['content']['application/json']

/** The one response that carries the plaintext code — it is never stored. */
export type IssuedAccessCode =
  paths['/api/v1/members/{memberId}/access-code']['post']['responses'][201]['content']['application/json']

/** The member's current code status; no plaintext ever. */
export type AccessCodeStatus =
  paths['/api/v1/members/{memberId}/access-code']['get']['responses'][200]['content']['application/json']

/** One row of the owner's device review of a member. */
export type MemberDevice =
  paths['/api/v1/members/{memberId}/sessions']['get']['responses'][200]['content']['application/json'][number]

/** The shortest contact value; mirrors the API contract's minLength. */
export const CONTACT_MIN_LENGTH = 3

const spaceQueryKey = (memberId: string | undefined) => ['member', memberId, 'space'] as const

export function useMemberSpace() {
  const memberId = getActiveMemberId()
  return useQuery({
    queryKey: spaceQueryKey(memberId),
    queryFn:
      memberId === undefined
        ? skipToken
        : async (): Promise<MemberSpace> => {
            const { data, error } = await api.GET('/api/v1/space', {
              params: { header: { 'x-ohana-member': memberId } },
            })
            await assertOk({ error })
            if (data === undefined) throw new ApiError('space_not_found')
            return data
          },
  })
}

function useInvalidateMemberArea() {
  const queryClient = useQueryClient()
  const memberId = getActiveMemberId()
  // The member-scoped subtree covers the space, the reviewed member's code
  // and devices, and the profiles list a role change or provisioning alters.
  return () => queryClient.invalidateQueries({ queryKey: ['member', memberId] })
}

export function useUpdateTimezone() {
  const invalidate = useInvalidateMemberArea()
  return useMutation({
    mutationFn: async (input: { timezone: string }) => {
      const response = await api.PATCH('/api/v1/space', {
        body: { timezone: input.timezone },
      })
      await assertOk(response)
    },
    onSettled: invalidate,
  })
}

export function useProvisionSpaceMember() {
  const invalidate = useInvalidateMemberArea()
  return useMutation({
    mutationFn: async (input: {
      name: string
      role: 'owner' | 'regular'
      displayName?: string
      email?: string
      phone?: string
      interfaceLanguage?: 'ru' | 'en'
    }): Promise<ProvisionedMember> => {
      const response = await api.POST('/api/v1/members', {
        body: input,
      })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    onSettled: invalidate,
  })
}

export function useChangeSpaceMemberRole() {
  const invalidate = useInvalidateMemberArea()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { memberId: string; role: 'owner' | 'regular' }) => {
      const response = await api.PATCH('/api/v1/members/{memberId}', {
        params: { path: { memberId: input.memberId } },
        body: { role: input.role },
      })
      await assertOk(response)
    },
    // A refused change (last_owner) must still refresh, or the screen keeps
    // offering a change the server will refuse again.
    onSettled: (_data, _error, variables) => {
      invalidate()
      // A member whose own role just changed carries the new role in the
      // session probe (/me): the owner instruments on screen must follow.
      if (variables.memberId === getActiveMemberId()) {
        void queryClient.invalidateQueries({ queryKey: memberSessionQueryKey })
      }
    },
  })
}

export function useIssueMemberAccessCode() {
  const invalidate = useInvalidateMemberArea()
  return useMutation({
    mutationFn: async (input: { memberId: string }): Promise<IssuedAccessCode> => {
      const response = await api.POST('/api/v1/members/{memberId}/access-code', {
        params: { path: { memberId: input.memberId } },
      })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    // Issuing replaces the member's older unused code: the status row and
    // the device list refresh either way.
    onSettled: invalidate,
  })
}

export function useRevokeMemberAccessCode() {
  const invalidate = useInvalidateMemberArea()
  return useMutation({
    mutationFn: async (input: { memberId: string }) => {
      const response = await api.DELETE('/api/v1/members/{memberId}/access-code', {
        params: { path: { memberId: input.memberId } },
      })
      await assertOk(response)
    },
    onSettled: invalidate,
  })
}

export function useMemberAccessCode(memberId: string) {
  const activeMemberId = getActiveMemberId()
  return useQuery({
    queryKey: [...spaceQueryKey(activeMemberId), 'codes', memberId],
    queryFn:
      activeMemberId === undefined
        ? skipToken
        : async (): Promise<AccessCodeStatus | null> => {
            const { data, error, response } = await api.GET(
              '/api/v1/members/{memberId}/access-code',
              {
                params: {
                  path: { memberId },
                  header: { 'x-ohana-member': activeMemberId },
                },
              },
            )
            // A member without codes is a state, not a failure: the owner
            // sees the "no code yet" row and issues the first one. Any other
            // 404 — a member of another space, for instance — is an error.
            if (response.status === 404 && extractErrorCode(error) === 'access_code_not_found') {
              return null
            }
            await assertOk({ error })
            return data ?? null
          },
  })
}

export function useMemberDevices(memberId: string) {
  const activeMemberId = getActiveMemberId()
  return useQuery({
    queryKey: [...spaceQueryKey(activeMemberId), 'devices', memberId],
    queryFn:
      activeMemberId === undefined
        ? skipToken
        : async (): Promise<MemberDevice[]> => {
            const { data, error } = await api.GET('/api/v1/members/{memberId}/sessions', {
              params: {
                path: { memberId },
                header: { 'x-ohana-member': activeMemberId },
              },
            })
            await assertOk({ error })
            return data ?? []
          },
  })
}

export function useRevokeMemberDevices() {
  const invalidate = useInvalidateMemberArea()
  return useMutation({
    mutationFn: async (input: { memberId: string }) => {
      const response = await api.DELETE('/api/v1/members/{memberId}/sessions', {
        params: { path: { memberId: input.memberId } },
      })
      await assertOk(response)
    },
    onSettled: invalidate,
  })
}

type SpaceSettingsErrorKey =
  | 'space.errors.owner_required'
  | 'space.errors.member_not_found'
  | 'space.errors.last_owner'
  | 'space.errors.invalid_timezone'
  | 'space.errors.access_code_not_found'
  | 'space.errors.access_code_used'
  | 'space.errors.access_code_expired'
  | 'space.errors.access_code_replaced'
  | 'space.errors.access_code_revoked'
  | 'space.errors.validation_failed'
  | 'space.errors.unexpected'

const spaceSettingsErrorKeys: Partial<Record<string, SpaceSettingsErrorKey>> = {
  owner_required: 'space.errors.owner_required',
  member_not_found: 'space.errors.member_not_found',
  last_owner: 'space.errors.last_owner',
  invalid_timezone: 'space.errors.invalid_timezone',
  access_code_not_found: 'space.errors.access_code_not_found',
  access_code_used: 'space.errors.access_code_used',
  access_code_expired: 'space.errors.access_code_expired',
  access_code_replaced: 'space.errors.access_code_replaced',
  access_code_revoked: 'space.errors.access_code_revoked',
  validation_failed: 'space.errors.validation_failed',
}

/** Translates a stable API error code into the caller's locale. */
export function spaceSettingsErrorMessage(
  error: unknown,
  translate: (key: SpaceSettingsErrorKey) => string,
): string {
  if (error instanceof ApiError) {
    const key = spaceSettingsErrorKeys[error.code]
    if (key !== undefined) return translate(key)
  }
  return translate('space.errors.unexpected')
}
