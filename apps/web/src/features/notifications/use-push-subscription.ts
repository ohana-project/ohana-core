import type { paths } from '@ohana/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/data/api.ts'
import { ApiError, assertOk, responseStatus } from '@/data/api-error.ts'
import {
  currentSubscription,
  type NotificationContainer,
  type PushRegistrar,
  type PushSubscriptionLike,
  subscribeOnDevice,
} from './push-client.ts'

/*
 * The device's push subscription (issue #22): the server data through the
 * generated client, the browser's half through the narrow push client.
 * The browser's physical subscription is one per origin — several members
 * can share a device — so what a member's switches read is their own
 * server row for that endpoint, never the browser's object.
 */

type PublicKeyResponse =
  paths['/api/v1/notifications/push/public-key']['get']['responses'][200]['content']['application/json']

type SubscriptionDto =
  paths['/api/v1/notifications/push/subscription']['get']['responses'][200]['content']['application/json']

type UnsubscribeResponse =
  paths['/api/v1/notifications/push/subscription']['delete']['responses'][200]['content']['application/json']

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
 * This browser's physical subscription, if the browser holds one: the
 * endpoint the actor's row is read and written through.
 */
export function useBrowserSubscription(registrar: PushRegistrar | undefined) {
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

  return { subscription, settled, refresh }
}

/**
 * The signed-in member's own row for this browser's endpoint: absent when
 * they never enabled reminders here — even when another member of the
 * same browser has. The 404 is the answer for absent, not an error.
 */
export function useMySubscription(
  browserSubscription: PushSubscriptionLike | null,
  refreshBrowser: () => Promise<void>,
) {
  const queryClient = useQueryClient()
  const endpoint = browserSubscription?.endpoint
  const query = useQuery({
    queryKey: ['push-subscription', endpoint],
    enabled: endpoint !== undefined,
    queryFn: async (): Promise<{ notifyDetails: boolean } | null> => {
      if (endpoint === undefined) return null
      const response = await api.GET('/api/v1/notifications/push/subscription', {
        params: { query: { endpoint } },
      })
      if (responseStatus(response) === 404) return null
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data as SubscriptionDto
    },
  })
  const refresh = useCallback(() => {
    void refreshBrowser()
    return queryClient.invalidateQueries({ queryKey: ['push-subscription'] })
  }, [queryClient, refreshBrowser])
  return { ...query, refresh }
}

/** PUT /api/v1/notifications/push/subscription — the member's device registers. */
export function useEnablePush(notification: NotificationContainer, registrar: PushRegistrar) {
  const publicKey = usePushPublicKey()
  return useMutation({
    mutationFn: async (input: { notifyDetails: boolean }): Promise<string> => {
      const key = await publicKey.refetch()
      const endpointPublicKey = key.data
      if (endpointPublicKey === undefined) throw new ApiError('unexpected')
      // The browser's physical subscription is reused when it exists —
      // enabling a second member on one device never re-subscribes.
      const existing = await currentSubscription(registrar)
      const result =
        existing !== null
          ? readSubscription(existing)
          : await subscribeOnDevice({
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
      return result.endpoint
    },
  })
}

function readSubscription(subscription: PushSubscriptionLike) {
  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (p256dh === undefined || auth === undefined) {
    throw new Error('The browser produced a push subscription without keys')
  }
  return { kind: 'subscribed' as const, endpoint: subscription.endpoint, p256dh, auth }
}

export class PushPermissionDeniedError extends Error {
  constructor() {
    super('The permission for notifications was not granted')
    this.name = 'PushPermissionDeniedError'
  }
}

/** DELETE /api/v1/notifications/push/subscription — this member's row goes. */
export function useDisablePush() {
  return useMutation({
    mutationFn: async (input: {
      memberId: string
      subscription: PushSubscriptionLike
    }): Promise<boolean> => {
      const response = await api.DELETE('/api/v1/notifications/push/subscription', {
        params: { header: { 'x-ohana-member': input.memberId } },
        body: { endpoint: input.subscription.endpoint },
      })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      const { releaseBrowserSubscription } = response.data as UnsubscribeResponse
      // The browser's subscription dies only when no member of this
      // browser holds it any more.
      if (releaseBrowserSubscription) await input.subscription.unsubscribe()
      return releaseBrowserSubscription
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
    },
  })
}

/**
 * The signed-out member's release (issue #22): their row for this
 * browser's endpoint goes with the session, and the browser's
 * subscription only when nobody holds it. Throws — the caller decides
 * what a failed release costs; a sign-out must not.
 */
export async function releasePushSubscription(memberId: string): Promise<void> {
  // getRegistration, not ready: a page with no worker (the development
  // server, a failed registration) answers at once instead of never.
  const registration = await navigator.serviceWorker?.getRegistration()
  if (registration === undefined) return
  const subscription = await currentSubscription(registration.pushManager)
  if (subscription === null) return
  const response = await api.DELETE('/api/v1/notifications/push/subscription', {
    params: { header: { 'x-ohana-member': memberId } },
    body: { endpoint: subscription.endpoint },
  })
  await assertOk(response)
  if (response.data === undefined) throw new ApiError('unexpected')
  const { releaseBrowserSubscription } = response.data as UnsubscribeResponse
  if (releaseBrowserSubscription) await subscription.unsubscribe()
}

/** Translates the enable flow's failures for the caller's locale. */
export function pushErrorMessage(error: unknown): 'denied' | 'generic' {
  return error instanceof PushPermissionDeniedError ? 'denied' : 'generic'
}
