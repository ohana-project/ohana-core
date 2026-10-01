import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/data/api.ts'
import { ApiError, assertOk } from '@/data/api-error.ts'
import { adminMarker } from '@/features/admin/use-admin-session.ts'

/*
 * The installation's settings (issue #16): online-only administrative data
 * through ordinary queries, like the session lists (architecture.md, web
 * rules). The trash retention is the one setting today; later ones join
 * the same hooks.
 */

export interface AdminSettings {
  trashRetentionDays: number
}

export function useAdminSettings() {
  return useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: async (): Promise<AdminSettings> => {
      const response = await api.GET('/api/v1/admin/settings')
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
  })
}

export function useAdminUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { trashRetentionDays: number }): Promise<AdminSettings> => {
      const response = await api.PUT('/api/v1/admin/settings', {
        body: input,
        headers: adminMarker,
      })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    // Re-probe instead of patching the cache by hand (architecture rules).
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] }),
  })
}
