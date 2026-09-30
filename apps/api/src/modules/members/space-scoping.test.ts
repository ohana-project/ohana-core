import { afterAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import { syncTombstones } from '../sync/tables.ts'
import { members } from './tables.ts'

/*
 * ADR-0016: space-owned rows reference each other through composite
 * (space_id, id) keys, so the database itself rejects a row in one space
 * pointing at a row in another. These tests pin that guarantee at the
 * lowest level, under the application logic.
 */

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

/** Asserts that the rejected query failed on exactly the named constraint. */
async function expectConstraint(rejection: Promise<unknown>, constraint: string): Promise<void> {
  const error = await rejection.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  expect(
    (error as { cause?: { constraint?: string } } | undefined)?.cause?.constraint,
    `expected the query to fail on ${constraint}`,
  ).toBe(constraint)
}

describe('space-scoped database conventions', () => {
  test('rejects a tombstone in one space that names a member of another', async () => {
    const family = await harness.createSpace()
    const other = await harness.createSpace()
    const familyMember = await harness.createMember(family.id, { name: 'Аня' })

    await expectConstraint(
      harness.db.insert(syncTombstones).values({
        spaceId: other.id,
        revision: 1n,
        entity: 'member',
        entityId: familyMember.id,
        audience: 'member',
        memberId: familyMember.id,
        createdAt: harness.clock.now(),
      }),
      'sync_tombstones_member_space_fk',
    )
  })

  test('accepts the same tombstone inside its own space', async () => {
    const family = await harness.createSpace()
    const familyMember = await harness.createMember(family.id, { name: 'Дима' })

    await harness.db.insert(syncTombstones).values({
      spaceId: family.id,
      revision: 1n,
      entity: 'member',
      entityId: familyMember.id,
      audience: 'member',
      memberId: familyMember.id,
      createdAt: harness.clock.now(),
    })
  })

  test('rejects a role outside owner and regular at the database level', async () => {
    const space = await harness.createSpace()
    await expectConstraint(
      harness.db.insert(members).values({
        spaceId: space.id,
        name: 'Самозванец',
        role: 'administrator',
        revision: 1n,
        createdAt: harness.clock.now(),
        updatedAt: harness.clock.now(),
      }),
      'members_role_allowed',
    )
  })

  test('rejects an interface language outside ru and en at the database level', async () => {
    const space = await harness.createSpace()
    await expectConstraint(
      harness.db.insert(members).values({
        spaceId: space.id,
        name: 'Пьер',
        interfaceLanguage: 'fr',
        role: 'regular',
        revision: 1n,
        createdAt: harness.clock.now(),
        updatedAt: harness.clock.now(),
      }),
      'members_interface_language_allowed',
    )
  })
})
