import { type Static, Type } from '@sinclair/typebox'

export const MemberRoleSchema = Type.Union([Type.Literal('owner'), Type.Literal('regular')])

export const InterfaceLanguageSchema = Type.Union([Type.Literal('ru'), Type.Literal('en')])

/** The shortest contact value, counted in code points like the JSON Schema minimum. */
export const CONTACT_MIN_LENGTH = 3

/** Any non-whitespace character somewhere in the value; whitespace-only values fail. */
const nameSchema = Type.String({ minLength: 1, maxLength: 200, pattern: '\\S' })
const contactSchema = (maxLength: number) =>
  Type.Optional(Type.String({ minLength: CONTACT_MIN_LENGTH, maxLength, pattern: '\\S' }))

export const MemberDtoSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    spaceId: Type.String({ format: 'uuid' }),
    name: Type.String(),
    displayName: Type.Optional(Type.String()),
    email: Type.Optional(Type.String()),
    phone: Type.Optional(Type.String()),
    interfaceLanguage: Type.Optional(InterfaceLanguageSchema),
    role: MemberRoleSchema,
    revision: Type.String({ pattern: '^[0-9]+$' }),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)

export type MemberDto = Static<typeof MemberDtoSchema>

export const ProvisionMemberBodySchema = Type.Object(
  {
    name: nameSchema,
    role: MemberRoleSchema,
    displayName: Type.Optional(nameSchema),
    email: contactSchema(200),
    phone: contactSchema(40),
    interfaceLanguage: Type.Optional(InterfaceLanguageSchema),
  },
  { additionalProperties: false },
)

export const ChangeMemberRoleBodySchema = Type.Object(
  { role: MemberRoleSchema },
  { additionalProperties: false },
)

export const SpaceIdParamsSchema = Type.Object({
  spaceId: Type.String({ format: 'uuid' }),
})

/** Only the role-change route names both the space and the member. */
export const MemberParamsSchema = Type.Object({
  spaceId: Type.String({ format: 'uuid' }),
  memberId: Type.String({ format: 'uuid' }),
})

/*
 * Member-facing contracts: what a signed-in member sees of a profile. The
 * provisioned name stays visible as the fallback, contacts stay
 * informational (CONTEXT.md, profile contact detail).
 */
export const MemberProfileDtoSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
    displayName: Type.Optional(Type.String()),
    email: Type.Optional(Type.String()),
    phone: Type.Optional(Type.String()),
    interfaceLanguage: Type.Optional(InterfaceLanguageSchema),
    role: MemberRoleSchema,
    createdAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)

export type MemberProfileDto = Static<typeof MemberProfileDtoSchema>

export const MeSchema = Type.Object(
  {
    member: MemberProfileDtoSchema,
    space: Type.Object(
      { id: Type.String({ format: 'uuid' }), name: Type.String() },
      { additionalProperties: false },
    ),
    needsOnboarding: Type.Boolean(),
  },
  { additionalProperties: false },
)

export type Me = Static<typeof MeSchema>

/** Onboarding collects the optional profile in one submission (ADR-0005). */
export const OnboardingBodySchema = Type.Object(
  {
    displayName: Type.Optional(nameSchema),
    email: contactSchema(200),
    phone: contactSchema(40),
    interfaceLanguage: Type.Optional(InterfaceLanguageSchema),
  },
  { additionalProperties: false },
)

export type OnboardingBody = Static<typeof OnboardingBodySchema>
