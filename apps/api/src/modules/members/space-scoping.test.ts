import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import { syncTombstones } from '../sync/tables.ts'
import { members } from './tables.ts'

/*
 * ADR-0016: space-owned rows reference each other through composite
 * (space_id, id) keys, so the database itself rejects a row in one space
 * pointing at a row in another. The tombstone-level rejection is pinned in
 * sync/service.test.ts; this file adds what only the members table can
 * show, under the application logic.
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
  test('a member cannot move to another space while a tombstone names it', async () => {
    const family = await harness.createSpace()
    const other = await harness.createSpace()
    const member = await harness.createMember(family.id, { name: 'Аня' })
    await harness.db.insert(syncTombstones).values({
      spaceId: family.id,
      revision: 1n,
      entity: 'member',
      entityId: member.id,
      audience: 'member',
      memberId: member.id,
      createdAt: harness.clock.now(),
    })

    // Moving the row would leave the tombstone referencing a member of a
    // space it does not name, so the composite key forbids the move.
    await expectConstraint(
      harness.db.update(members).set({ spaceId: other.id }).where(eq(members.id, member.id)),
      'sync_tombstones_member_space_fk',
    )
  })

  test('rejects a role outside owner and regular at the database level', async () => {
    const space = await harness.createSpace()
    await expectConstraint(
      harness.db.insert(members).values({
        spaceId: space.id,
        name: 'Самозванец',
        // Deliberately invalid: the check constraint must reject it.
        role: 'administrator' as unknown as 'owner' | 'regular',
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
        // Deliberately invalid: the check constraint must reject it.
        interfaceLanguage: 'fr' as unknown as 'ru' | 'en',
        role: 'regular',
        revision: 1n,
        createdAt: harness.clock.now(),
        updatedAt: harness.clock.now(),
      }),
      'members_interface_language_allowed',
    )
  })
})
