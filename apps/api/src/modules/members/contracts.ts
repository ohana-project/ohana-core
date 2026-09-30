import { type Static, Type } from '@sinclair/typebox'

export const MemberRoleSchema = Type.Union([Type.Literal('owner'), Type.Literal('regular')])

export const InterfaceLanguageSchema = Type.Union([Type.Literal('ru'), Type.Literal('en')])

/** Any non-whitespace character somewhere in the value; whitespace-only values fail. */
const nameSchema = Type.String({ minLength: 1, maxLength: 200, pattern: '\\S' })
const contactSchema = (maxLength: number) =>
  Type.Optional(Type.String({ minLength: 3, maxLength, pattern: '\\S' }))

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
