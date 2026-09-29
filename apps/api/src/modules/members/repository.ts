import type { Tx } from '../../platform/db/index.ts'
import { type Member, type memberRoles, members } from './tables.ts'

export interface NewMember {
  name: string
  role: (typeof memberRoles)[number]
  revision: bigint
  now: Date
}

export async function insertMember(tx: Tx, spaceId: string, data: NewMember): Promise<Member> {
  const inserted = await tx
    .insert(members)
    .values({
      spaceId,
      name: data.name,
      role: data.role,
      revision: data.revision,
      createdAt: data.now,
      updatedAt: data.now,
    })
    .returning()
  const row = inserted[0]
  if (!row) throw new Error('Inserting a member returned no row')
  return row
}
