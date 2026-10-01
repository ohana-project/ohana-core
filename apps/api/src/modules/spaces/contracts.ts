import { type Static, Type } from '@sinclair/typebox'

/** Any non-whitespace character somewhere in the value; whitespace-only names fail. */
const nameSchema = Type.String({ minLength: 1, maxLength: 200, pattern: '\\S' })

export const SpaceDtoSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
    timezone: Type.String({ minLength: 1, maxLength: 64 }),
    revision: Type.String({ pattern: '^[0-9]+$' }),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)

export type SpaceDto = Static<typeof SpaceDtoSchema>

export const SpaceWithMemberCountDtoSchema = Type.Object(
  {
    ...SpaceDtoSchema.properties,
    memberCount: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
)

export type SpaceWithMemberCountDto = Static<typeof SpaceWithMemberCountDtoSchema>

export const CreateSpaceBodySchema = Type.Object(
  {
    name: nameSchema,
    timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false },
)

export const UpdateSpaceBodySchema = Type.Object(
  {
    name: Type.Optional(nameSchema),
    timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false, minProperties: 1 },
)

export const SpaceIdParamsSchema = Type.Object({
  spaceId: Type.String({ format: 'uuid' }),
})

/*
 * Member-facing contracts (issue #12): what a signed-in member sees of their
 * space, and the one setting an owner changes from the member side. The
 * space never comes from the URL — it is the authenticated actor's.
 */
export const MemberSpaceDtoSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
    timezone: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
)

export type MemberSpaceDto = Static<typeof MemberSpaceDtoSchema>

export const UpdateMemberSpaceBodySchema = Type.Object(
  {
    timezone: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
)
