import { Type } from '@sinclair/typebox'

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

export const CreateSpaceBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
)

export interface SpaceDto {
  id: string
  name: string
  revision: string
  createdAt: string
  updatedAt: string
}
