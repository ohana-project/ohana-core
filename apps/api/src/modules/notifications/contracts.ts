import { type Static, Type } from '@sinclair/typebox'

/*
 * The push subscriptions' wire contracts (issue #22). The endpoint is the
 * device's address; the keys are the RFC 8291 pair the browser hands the
 * page at subscription time. The opt-in rides every write, so one round
 * trip both registers the device and states its choice about event
 * details.
 */

/** A push endpoint URL — https everywhere, the browsers' own guarantee. */
const endpointSchema = Type.String({ minLength: 1, maxLength: 2048 })

/** Base64url, RFC 8291's wire encoding for both keys. */
const keyMaterialSchema = Type.String({ minLength: 1, maxLength: 512 })

export const PushSubscriptionBodySchema = Type.Object(
  {
    endpoint: endpointSchema,
    keys: Type.Object(
      { p256dh: keyMaterialSchema, auth: keyMaterialSchema },
      { additionalProperties: false },
    ),
    notifyDetails: Type.Boolean(),
  },
  { additionalProperties: false },
)

export type PushSubscriptionBody = Static<typeof PushSubscriptionBodySchema>

export const PushSubscriptionDetailsBodySchema = Type.Object(
  {
    endpoint: endpointSchema,
    notifyDetails: Type.Boolean(),
  },
  { additionalProperties: false },
)

export type PushSubscriptionDetailsBody = Static<typeof PushSubscriptionDetailsBodySchema>

export const PushUnsubscribeBodySchema = Type.Object(
  { endpoint: endpointSchema },
  { additionalProperties: false },
)

export type PushUnsubscribeBody = Static<typeof PushUnsubscribeBodySchema>

/** The installation's public VAPID key, the browser signs up against. */
export const PushPublicKeyDtoSchema = Type.Object(
  { publicKey: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
)

export type PushPublicKeyDto = Static<typeof PushPublicKeyDtoSchema>
