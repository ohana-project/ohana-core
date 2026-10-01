import { type Static, type TSchema, Type } from '@sinclair/typebox'

/**
 * The delta-sync contract (issue #14, ADR-0014): a member hands over the
 * last revision they have seen and receives the changes and tombstones
 * since it, plus the new revision. The change variants live with the
 * modules that own them — spaces and members export their change schemas,
 * and the sync route composes the response union from the wired
 * contributors (architecture.md, "Sync contributors"), so a section module
 * plugs in without editing the sync module.
 */

/** The cursor: a plain non-negative integer. 18 digits keep every accepted
 * value inside the space revision's bigint range, so an out-of-range
 * cursor is a 400 here instead of a database error later. */
export const SyncQuerySchema = Type.Object({
  since: Type.String({ pattern: '^[0-9]+$', maxLength: 18 }),
})

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

/** The response contract for one set of wired contributors. */
export function syncResponseSchema(changeSchemas: readonly TSchema[]): TSchema {
  return Type.Object(
    {
      revision: Type.String({ pattern: '^[0-9]+$' }),
      changes: Type.Array(
        changeSchemas.length > 0 ? Type.Union([...changeSchemas]) : Type.Unknown(),
      ),
      tombstones: Type.Array(SyncTombstoneDtoSchema),
    },
    { additionalProperties: false },
  )
}
