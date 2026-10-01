import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { ApiError, assertOk } from '@/data/api-error.ts'

/*
 * The administrative area is online-only (no local store): the session
 * probe, sign-in, sign-out, and password change are ordinary queries and
 * mutations. State-changing calls carry the X-Ohana-Admin marker header —
 * together with the SameSite cookie it is the CSRF defence.
 */

const adminSessionQueryKey = ['admin', 'session'] as const

export type AdminSessionState = 'signed-in' | 'signed-out'

export const adminMarker = { 'x-ohana-admin': '1' }

export function useAdminSession() {
  return useQuery({
    queryKey: adminSessionQueryKey,
    queryFn: async (): Promise<AdminSessionState> => {
      // 204 means the administrative session cookie is valid; any rejection
      // (including 401) means signed out — that is a state, not a failure.
      const { error } = await api.GET('/api/v1/admin/session')
      return error === undefined ? 'signed-in' : 'signed-out'
    },
  })
}

export function useAdminSignIn() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (password: string) => {
      const response = await api.POST('/api/v1/admin/session', {
        body: { password },
        headers: adminMarker,
      })
      await assertOk(response)
    },
    // Re-probe instead of patching the cache by hand (architecture rules).
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminSessionQueryKey }),
  })
}

export function useAdminSignOut() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const response = await api.DELETE('/api/v1/admin/session', { headers: adminMarker })
      await assertOk(response)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminSessionQueryKey }),
  })
}

export function useAdminChangePassword() {
  return useMutation({
    mutationFn: async (input: { currentPassword: string; newPassword: string }) => {
      const response = await api.POST('/api/v1/admin/password', {
        body: input,
        headers: adminMarker,
      })
      await assertOk(response)
    },
  })
}

type AdminErrorKey =
  | 'admin.errors.invalid_credentials'
  | 'admin.errors.password_too_short'
  | 'admin.errors.unauthorized'
  | 'admin.errors.missing_admin_header'
  | 'admin.errors.unexpected'

const adminErrorKeys: Partial<Record<string, AdminErrorKey>> = {
  invalid_credentials: 'admin.errors.invalid_credentials',
  password_too_short: 'admin.errors.password_too_short',
  unauthorized: 'admin.errors.unauthorized',
  missing_admin_header: 'admin.errors.missing_admin_header',
}

/** Translates a stable API error code into the caller's locale. */
export function adminErrorMessage(
  error: unknown,
  translate: (key: AdminErrorKey) => string,
): string {
  if (error instanceof ApiError) {
    const key = adminErrorKeys[error.code]
    if (key !== undefined) return translate(key)
  }
  return translate('admin.errors.unexpected')
}
