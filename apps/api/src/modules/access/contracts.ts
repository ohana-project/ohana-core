import { type Static, Type } from '@sinclair/typebox'

/**
 * The header every member-facing request carries (architecture.md, request
 * lifecycle): the member the request names. Declared optional the way the
 * administrative marker is — the guard itself rejects a missing header —
 * so the document names the header without making clients re-declare what
 * the API client injects on every request.
 */
export const MEMBER_HEADER = 'x-ohana-member'

export const MemberHeadersSchema = Type.Object({
  'x-ohana-member': Type.Optional(Type.String({ format: 'uuid' })),
})

/** Sign-out still names its member: the route clears that member's cookie. */
export const MemberSessionHeadersSchema = Type.Object({
  'x-ohana-member': Type.String({ format: 'uuid' }),
})

export type MemberHeaders = Static<typeof MemberHeadersSchema>

export type MemberSessionHeaders = Static<typeof MemberSessionHeadersSchema>

/** The body of the one unauthenticated member route: code redemption. */
export const RedeemBodySchema = Type.Object(
  {
    // Any letter case, with or without the hyphen; the service normalises.
    code: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
)

export type RedeemBody = Static<typeof RedeemBodySchema>

export const AccessCodeStatusSchema = Type.Union([
  Type.Literal('issued'),
  Type.Literal('redeemed'),
  Type.Literal('expired'),
  Type.Literal('replaced'),
  Type.Literal('revoked'),
])

export type AccessCodeStatus = Static<typeof AccessCodeStatusSchema>

/** The administrative listing never carries the plaintext code. */
export const AccessCodeDtoSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    memberId: Type.String({ format: 'uuid' }),
    status: AccessCodeStatusSchema,
    createdAt: Type.String({ format: 'date-time' }),
    expiresAt: Type.String({ format: 'date-time' }),
    statusChangedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)

export type AccessCodeDto = Static<typeof AccessCodeDtoSchema>

/** The issuance response is the one place the plaintext code appears. */
export const IssuedAccessCodeDtoSchema = Type.Composite(
  [AccessCodeDtoSchema, Type.Object({ code: Type.String() })],
  {
    additionalProperties: false,
  },
)

export type IssuedAccessCodeDto = Static<typeof IssuedAccessCodeDtoSchema>

/** Who a redeemed code signs in, with what the session registry needs. */
export const RedeemedMemberSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
    displayName: Type.Optional(Type.String()),
    role: Type.Union([Type.Literal('owner'), Type.Literal('regular')]),
  },
  { additionalProperties: false },
)

export const RedeemResponseSchema = Type.Object(
  {
    member: RedeemedMemberSchema,
    space: Type.Object(
      {
        id: Type.String({ format: 'uuid' }),
        name: Type.String(),
      },
      { additionalProperties: false },
    ),
    needsOnboarding: Type.Boolean(),
  },
  { additionalProperties: false },
)

export type RedeemResponse = Static<typeof RedeemResponseSchema>

export const SpaceIdParamsSchema = Type.Object({
  spaceId: Type.String({ format: 'uuid' }),
})

/** Only the issuance route names both the space and the member. */
export const AccessCodeIssueParamsSchema = Type.Object({
  spaceId: Type.String({ format: 'uuid' }),
  memberId: Type.String({ format: 'uuid' }),
})

/** Only the revoke route names both the space and the code. */
export const AccessCodeParamsSchema = Type.Object({
  spaceId: Type.String({ format: 'uuid' }),
  codeId: Type.String({ format: 'uuid' }),
})
