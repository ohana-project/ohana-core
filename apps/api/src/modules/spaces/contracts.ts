import { type Static, Type } from '@sinclair/typebox'

export const SpaceDtoSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
    revision: Type.String({ pattern: '^[0-9]+$' }),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)

export type SpaceDto = Static<typeof SpaceDtoSchema>

export const CreateSpaceBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
)
