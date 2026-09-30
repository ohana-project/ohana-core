import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/data/api.ts'

/*
 * The administrative area is online-only (no local store): the session
 * probe, sign-in, sign-out, and password change are ordinary queries and
 * mutations. State-changing calls carry the X-Ohana-Admin marker header —
 * together with the SameSite cookie it is the CSRF defence.
 */

const adminSessionQueryKey = ['admin', 'session'] as const

export type AdminSessionState = 'signed-in' | 'signed-out'

export class AdminApiError extends Error {
  readonly code: string

  constructor(code: string) {
    super(`The API rejected the request with ${code}`)
    this.name = 'AdminApiError'
    this.code = code
  }
}

function extractErrorCode(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const code = (body as { error?: { code?: unknown } }).error?.code
    if (typeof code === 'string') return code
  }
  return 'unexpected'
}

const adminMarker = { 'x-ohana-admin': '1' }

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
      const { error } = await api.POST('/api/v1/admin/session', {
        body: { password },
        headers: adminMarker,
      })
      if (error !== undefined) throw new AdminApiError(extractErrorCode(error))
    },
    // Re-probe instead of patching the cache by hand (architecture rules).
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminSessionQueryKey }),
  })
}

export function useAdminSignOut() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE('/api/v1/admin/session', { headers: adminMarker })
      if (error !== undefined) throw new AdminApiError(extractErrorCode(error))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminSessionQueryKey }),
  })
}

export function useAdminChangePassword() {
  return useMutation({
    mutationFn: async (input: { currentPassword: string; newPassword: string }) => {
      const { error } = await api.POST('/api/v1/admin/password', {
        body: input,
        headers: adminMarker,
      })
      if (error !== undefined) throw new AdminApiError(extractErrorCode(error))
    },
  })
}

/** Translates a stable API error code into the caller's locale. */
export function adminErrorMessage(
  error: unknown,
  translate: (key: 'admin.errors.invalid_credentials' | 'admin.errors.unexpected') => string,
): string {
  if (error instanceof AdminApiError && error.code === 'invalid_credentials') {
    return translate('admin.errors.invalid_credentials')
  }
  return translate('admin.errors.unexpected')
}
