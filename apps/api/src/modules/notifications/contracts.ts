import { type Static, Type } from '@sinclair/typebox'

/*
 * The push subscriptions' wire contracts (issue #22). The endpoint is the
 * device's address; the keys are the RFC 8291 pair the browser hands the
 * page at subscription time. The opt-in rides every write, so one round
 * trip both registers the device and states its choice about event
 * details.
 */

/** A push endpoint URL: the browsers mint https endpoints on public push
 *  services; the service refuses the rest (the SSRF a private address
 *  would invite), the shape here only pins the scheme. */
const endpointSchema = Type.String({
  minLength: 1,
  maxLength: 2048,
  pattern: '^https://',
})

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

/** The lookup the screen reads its own row through: the endpoint is the
 *  browser's, the row is the actor's. */
export const PushSubscriptionParamsSchema = Type.Object(
  { endpoint: endpointSchema },
  { additionalProperties: false },
)

export type PushSubscriptionParams = Static<typeof PushSubscriptionParamsSchema>

/** The actor's row as the screen sees it. */
export const PushSubscriptionDtoSchema = Type.Object(
  { notifyDetails: Type.Boolean() },
  { additionalProperties: false },
)

export type PushSubscriptionDto = Static<typeof PushSubscriptionDtoSchema>

/** Whether nobody holds the browser's physical subscription any more. */
export const PushUnsubscribeDtoSchema = Type.Object(
  { releaseBrowserSubscription: Type.Boolean() },
  { additionalProperties: false },
)

export type PushUnsubscribeDto = Static<typeof PushUnsubscribeDtoSchema>

/** The installation's public VAPID key, the browser signs up against. */
export const PushPublicKeyDtoSchema = Type.Object(
  { publicKey: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
)

export type PushPublicKeyDto = Static<typeof PushPublicKeyDtoSchema>
