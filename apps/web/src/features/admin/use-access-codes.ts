import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { ApiError, assertOk } from '@/data/api-error.ts'
import { adminSpaceErrorMessage } from '@/features/admin/use-admin-spaces.ts'

/*
 * Access codes are online-only administrative data (no local store):
 * ordinary queries and mutations over the generated client, marker header
 * on every state-changing call.
 */

const adminMarker = { 'x-ohana-admin': '1' }

export type AdminAccessCode = {
  id: string
  memberId: string
  status: 'issued' | 'redeemed' | 'expired' | 'replaced' | 'revoked'
  createdAt: string
  expiresAt: string
  statusChangedAt: string
}

/** The one response that carries the plaintext code — it is never stored. */
export type IssuedAccessCode = AdminAccessCode & { code: string }

function accessCodesQueryKey(spaceId: string) {
  return ['admin', 'spaces', spaceId, 'access-codes'] as const
}

export function useAccessCodes(spaceId: string) {
  return useQuery({
    queryKey: accessCodesQueryKey(spaceId),
    queryFn: async (): Promise<AdminAccessCode[]> => {
      const { data, error } = await api.GET('/api/v1/spaces/{spaceId}/access-codes', {
        params: { path: { spaceId } },
      })
      await assertOk({ error })
      return data ?? []
    },
  })
}

export function useIssueAccessCode(spaceId: string) {
  const invalidate = useInvalidateAccessCodes(spaceId)
  return useMutation({
    mutationFn: async (input: { memberId: string }): Promise<IssuedAccessCode> => {
      const response = await api.POST('/api/v1/spaces/{spaceId}/members/{memberId}/access-codes', {
        params: { path: { spaceId, memberId: input.memberId } },
        headers: adminMarker,
      })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    onSettled: invalidate,
  })
}

export function useRevokeAccessCode(spaceId: string) {
  const invalidate = useInvalidateAccessCodes(spaceId)
  return useMutation({
    mutationFn: async (input: { codeId: string }): Promise<AdminAccessCode> => {
      const response = await api.POST('/api/v1/spaces/{spaceId}/access-codes/{codeId}/revoke', {
        params: { path: { spaceId, codeId: input.codeId } },
        headers: adminMarker,
      })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    // A refused revocation (someone else was faster) must still refresh.
    onSettled: invalidate,
  })
}

function useInvalidateAccessCodes(spaceId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: accessCodesQueryKey(spaceId) })
}

type AccessCodeErrorKey =
  | 'admin.errors.access_code_not_found'
  | 'admin.errors.access_code_used'
  | 'admin.errors.access_code_expired'
  | 'admin.errors.access_code_replaced'
  | 'admin.errors.access_code_revoked'

const accessCodeErrorKeys: Partial<Record<string, AccessCodeErrorKey>> = {
  access_code_not_found: 'admin.errors.access_code_not_found',
  access_code_used: 'admin.errors.access_code_used',
  access_code_expired: 'admin.errors.access_code_expired',
  access_code_replaced: 'admin.errors.access_code_replaced',
  access_code_revoked: 'admin.errors.access_code_revoked',
}

/** Translates code-lifecycle errors, falling back to the shared admin map. */
export function accessCodeErrorMessage(error: unknown, translate: (key: string) => string): string {
  if (error instanceof ApiError) {
    const key = accessCodeErrorKeys[error.code]
    if (key !== undefined) return translate(key)
  }
  return adminSpaceErrorMessage(error, translate)
}
