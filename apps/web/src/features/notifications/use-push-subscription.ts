import type { paths } from '@ohana/api-client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/data/api.ts'
import { ApiError, assertOk } from '@/data/api-error.ts'
import {
  currentSubscription,
  type NotificationContainer,
  type PushRegistrar,
  type PushSubscriptionLike,
  readStoredDetails,
  storeDetails,
  subscribeOnDevice,
} from './push-client.ts'

/*
 * The device's push subscription (issue #22): the server data through the
 * generated client, the browser's half through the narrow push client. A
 * member enables notifications per device, after the browser's own user
 * gesture; the per-device opt-in to event details rides the same rows.
 */

type PublicKeyResponse =
  paths['/api/v1/notifications/push/public-key']['get']['responses'][200]['content']['application/json']

/** The installation's public VAPID key, what the browser signs up against. */
export function usePushPublicKey() {
  return useQuery({
    queryKey: ['push-public-key'],
    queryFn: async (): Promise<string> => {
      const response = await api.GET('/api/v1/notifications/push/public-key')
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return (response.data as PublicKeyResponse).publicKey
    },
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * This device's subscription state: what the browser holds, plus the
 * opt-in the page stored when the device last subscribed (the server's
 * sending value is written at the same moments).
 */
export function useDeviceSubscription(registrar: PushRegistrar | undefined) {
  const [subscription, setSubscription] = useState<PushSubscriptionLike | null>(null)
  const [settled, setSettled] = useState(false)

  const refresh = useCallback(async () => {
    if (registrar === undefined) {
      setSubscription(null)
      setSettled(true)
      return
    }
    try {
      setSubscription(await currentSubscription(registrar))
    } catch {
      setSubscription(null)
    } finally {
      setSettled(true)
    }
  }, [registrar])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const details = readStoredDetails(subscription?.endpoint ?? '')
  return { subscription, settled, details, refresh }
}

/** PUT /api/v1/notifications/push/subscription — the device registers. */
export function useEnablePush(notification: NotificationContainer, registrar: PushRegistrar) {
  const publicKey = usePushPublicKey()
  return useMutation({
    mutationFn: async (input: { notifyDetails: boolean }): Promise<string> => {
      const key = await publicKey.refetch()
      const endpointPublicKey = key.data
      if (endpointPublicKey === undefined) throw new ApiError('unexpected')
      const result = await subscribeOnDevice({
        notification,
        registrar,
        publicKey: endpointPublicKey,
      })
      if (result.kind !== 'subscribed') throw new PushPermissionDeniedError()
      const response = await api.PUT('/api/v1/notifications/push/subscription', {
        body: {
          endpoint: result.endpoint,
          keys: { p256dh: result.p256dh, auth: result.auth },
          notifyDetails: input.notifyDetails,
        },
      })
      await assertOk(response)
      storeDetails(result.endpoint, input.notifyDetails)
      return result.endpoint
    },
  })
}

export class PushPermissionDeniedError extends Error {
  constructor() {
    super('The permission for notifications was not granted')
    this.name = 'PushPermissionDeniedError'
  }
}

/** DELETE /api/v1/notifications/push/subscription — the device leaves. */
export function useDisablePush() {
  return useMutation({
    mutationFn: async (subscription: PushSubscriptionLike): Promise<void> => {
      await subscription.unsubscribe()
      const response = await api.DELETE('/api/v1/notifications/push/subscription', {
        body: { endpoint: subscription.endpoint },
      })
      await assertOk(response)
    },
  })
}

/** PATCH /api/v1/notifications/push/subscription — the device's opt-in. */
export function useSetNotifyDetails() {
  return useMutation({
    mutationFn: async (input: { endpoint: string; notifyDetails: boolean }): Promise<void> => {
      const response = await api.PATCH('/api/v1/notifications/push/subscription', {
        body: { endpoint: input.endpoint, notifyDetails: input.notifyDetails },
      })
      await assertOk(response)
      storeDetails(input.endpoint, input.notifyDetails)
    },
  })
}

/** Translates the enable flow's failures for the caller's locale. */
export function pushErrorMessage(error: unknown): 'denied' | 'generic' {
  return error instanceof PushPermissionDeniedError ? 'denied' : 'generic'
}
