import { type Static, Type } from '@sinclair/typebox'
import { MemberProfileDtoSchema } from '../members/index.ts'
import { MemberSpaceDtoSchema } from '../spaces/index.ts'

/*
 * The delta-sync contract (issue #14, ADR-0014): a member hands over the
 * last revision they have seen and receives the changes and tombstones
 * since it, plus the new revision. The payload schemas are the modules'
 * own published DTOs — the sync response carries exactly what the ordinary
 * reads carry, so the client stores one shape per entity.
 */

/** The cursor: a plain non-negative integer, well inside bigint range. */
export const SyncQuerySchema = Type.Object({
  since: Type.String({ pattern: '^[0-9]+$', maxLength: 20 }),
})

export const SyncSpaceChangeSchema = Type.Object(
  { entity: Type.Literal('space'), space: MemberSpaceDtoSchema },
  { additionalProperties: false },
)

export const SyncMemberChangeSchema = Type.Object(
  { entity: Type.Literal('member'), member: MemberProfileDtoSchema },
  { additionalProperties: false },
)

export const SyncChangeSchema = Type.Union([SyncSpaceChangeSchema, SyncMemberChangeSchema])

export type SyncChange = Static<typeof SyncChangeSchema>

export const SyncTombstoneDtoSchema = Type.Object(
  {
    entity: Type.String(),
    entityId: Type.String({ format: 'uuid' }),
    audience: Type.Union([Type.Literal('all'), Type.Literal('member')]),
    memberId: Type.Optional(Type.String({ format: 'uuid' })),
  },
  { additionalProperties: false },
)

export type SyncTombstoneDto = Static<typeof SyncTombstoneDtoSchema>

export const SyncResponseSchema = Type.Object(
  {
    revision: Type.String({ pattern: '^[0-9]+$' }),
    changes: Type.Array(SyncChangeSchema),
    tombstones: Type.Array(SyncTombstoneDtoSchema),
  },
  { additionalProperties: false },
)

export type SyncResponseDto = Static<typeof SyncResponseSchema>
