import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { ApiError, assertOk } from '@/data/api-error.ts'

/*
 * The administrative spaces and members screens are online-only (no local
 * store): ordinary queries and mutations over the generated client. Every
 * state-changing call carries the X-Ohana-Admin marker header — together
 * with the SameSite cookie it is the CSRF defence.
 */

const adminMarker = { 'x-ohana-admin': '1' }

/** The shortest contact value; mirrors the API contract's minLength. */
export const CONTACT_MIN_LENGTH = 3

const spacesQueryKey = ['admin', 'spaces'] as const

export type AdminSpace = {
  id: string
  name: string
  timezone: string
  revision: string
  memberCount: number
  createdAt: string
  updatedAt: string
}

/** The single-space response carries no member count. */
export type AdminSpaceSummary = Omit<AdminSpace, 'memberCount'>

export type AdminMember = {
  id: string
  spaceId: string
  name: string
  displayName?: string
  email?: string
  phone?: string
  interfaceLanguage?: 'ru' | 'en'
  role: 'owner' | 'regular'
  // The archiving stamps (issue #23), absent while the member is active.
  archivedAt?: string
  privateStatePurgedAt?: string
  revision: string
  createdAt: string
  updatedAt: string
}

export function useAdminSpaces() {
  return useQuery({
    queryKey: spacesQueryKey,
    queryFn: async (): Promise<AdminSpace[]> => {
      const { data, error } = await api.GET('/api/v1/spaces')
      await assertOk({ error })
      return data ?? []
    },
  })
}

export function useAdminSpace(spaceId: string) {
  return useQuery({
    queryKey: [...spacesQueryKey, spaceId],
    queryFn: async (): Promise<AdminSpaceSummary> => {
      const { data, error } = await api.GET('/api/v1/spaces/{spaceId}', {
        params: { path: { spaceId } },
      })
      await assertOk({ error })
      if (data === undefined) throw new ApiError('space_not_found')
      return data
    },
  })
}

function useInvalidateSpaces() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: spacesQueryKey })
}

export function useCreateSpace() {
  const invalidate = useInvalidateSpaces()
  return useMutation({
    mutationFn: async (input: { name: string; timezone?: string }) => {
      const response = await api.POST('/api/v1/spaces', {
        body: input,
        headers: adminMarker,
      })
      await assertOk(response)
    },
    onSuccess: invalidate,
  })
}

export function useUpdateSpace(spaceId: string) {
  const invalidate = useInvalidateSpaces()
  return useMutation({
    mutationFn: async (input: { name?: string; timezone?: string }) => {
      const response = await api.PATCH('/api/v1/spaces/{spaceId}', {
        params: { path: { spaceId } },
        body: input,
        headers: adminMarker,
      })
      await assertOk(response)
    },
    onSuccess: invalidate,
  })
}

export function useSpaceMembers(spaceId: string) {
  return useQuery({
    queryKey: [...spacesQueryKey, spaceId, 'members'],
    queryFn: async (): Promise<AdminMember[]> => {
      const { data, error } = await api.GET('/api/v1/spaces/{spaceId}/members', {
        params: { path: { spaceId } },
      })
      await assertOk({ error })
      return data ?? []
    },
  })
}

export type ProvisionMemberInput = {
  name: string
  role: 'owner' | 'regular'
  displayName?: string
  email?: string
  phone?: string
  interfaceLanguage?: 'ru' | 'en'
}

export function useProvisionMember(spaceId: string) {
  const invalidate = useInvalidateSpaces()
  return useMutation({
    mutationFn: async (input: ProvisionMemberInput) => {
      const response = await api.POST('/api/v1/spaces/{spaceId}/members', {
        params: { path: { spaceId } },
        body: input,
        headers: adminMarker,
      })
      await assertOk(response)
    },
    // A refused request must still refresh: another actor may have changed
    // what this one was refused against.
    onSettled: invalidate,
  })
}

export function useChangeMemberRole(spaceId: string) {
  const invalidate = useInvalidateSpaces()
  return useMutation({
    mutationFn: async (input: { memberId: string; role: 'owner' | 'regular' }) => {
      const response = await api.PATCH('/api/v1/spaces/{spaceId}/members/{memberId}', {
        params: { path: { spaceId, memberId: input.memberId } },
        body: { role: input.role },
        headers: adminMarker,
      })
      await assertOk(response)
    },
    // A refused request (last_owner, for instance) must still refresh, or
    // the screen keeps offering a change the server will refuse again.
    onSettled: invalidate,
  })
}

type AdminSpaceErrorKey =
  | 'admin.errors.invalid_credentials'
  | 'admin.errors.password_too_short'
  | 'admin.errors.unauthorized'
  | 'admin.errors.missing_admin_header'
  | 'admin.errors.space_not_found'
  | 'admin.errors.invalid_timezone'
  | 'admin.errors.member_not_found'
  | 'admin.errors.last_owner'
  | 'admin.errors.member_archived'
  | 'admin.errors.member_purged'
  | 'admin.errors.validation_failed'
  | 'admin.errors.unexpected'

const adminSpaceErrorKeys: Partial<Record<string, AdminSpaceErrorKey>> = {
  invalid_credentials: 'admin.errors.invalid_credentials',
  password_too_short: 'admin.errors.password_too_short',
  unauthorized: 'admin.errors.unauthorized',
  missing_admin_header: 'admin.errors.missing_admin_header',
  space_not_found: 'admin.errors.space_not_found',
  invalid_timezone: 'admin.errors.invalid_timezone',
  member_not_found: 'admin.errors.member_not_found',
  last_owner: 'admin.errors.last_owner',
  member_archived: 'admin.errors.member_archived',
  member_purged: 'admin.errors.member_purged',
  validation_failed: 'admin.errors.validation_failed',
}

/** Translates a stable API error code into the caller's locale. */
export function adminSpaceErrorMessage(
  error: unknown,
  translate: (key: AdminSpaceErrorKey) => string,
): string {
  if (error instanceof ApiError) {
    const key = adminSpaceErrorKeys[error.code]
    if (key !== undefined) return translate(key)
  }
  return translate('admin.errors.unexpected')
}
