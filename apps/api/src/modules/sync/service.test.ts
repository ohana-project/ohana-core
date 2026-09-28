import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import type { Tx } from '../../platform/db/index.ts'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import { type Member, members } from '../members/index.ts'
import { getSpaceById } from '../spaces/index.ts'
import { recordChanges } from './index.ts'
import { syncTombstones } from './tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

async function memberById(id: string): Promise<Member | undefined> {
  const rows = await harness.db.select().from(members).where(eq(members.id, id)).limit(1)
  return rows[0]
}

async function tombstonesFor(spaceId: string) {
  return harness.db.select().from(syncTombstones).where(eq(syncTombstones.spaceId, spaceId))
}

describe('recordChanges', () => {
  test('increments the space revision once, stamps written rows, and writes tombstones', async () => {
    const space = await harness.createSpace()
    const renamed = await harness.createMember(space.id, { name: 'Before' })
    const archived = await harness.createMember(space.id, { name: 'Archived me' })

    const returnedRevision = await harness.db.transaction(async (tx: Tx) =>
      recordChanges(
        tx,
        space.id,
        {
          writes: (revision) =>
            tx
              .update(members)
              .set({ name: 'After', revision, updatedAt: harness.clock.now() })
              .where(eq(members.id, renamed.id)),
          tombstones: [{ entity: 'member', entityId: archived.id, audience: { kind: 'all' } }],
        },
        harness.clock.now(),
      ),
    )

    expect(returnedRevision).toBe(1n)

    const spaceRow = await getSpaceById(harness.db, space.id)
    expect(spaceRow?.revision).toBe(1n)

    const renamedRow = await memberById(renamed.id)
    expect(renamedRow?.name).toBe('After')
    expect(renamedRow?.revision).toBe(1n)

    const archivedRow = await memberById(archived.id)
    expect(archivedRow?.revision).toBe(0n)

    const tombstones = await tombstonesFor(space.id)
    expect(tombstones).toHaveLength(1)
    expect(tombstones[0]).toMatchObject({
      spaceId: space.id,
      revision: 1n,
      entity: 'member',
      entityId: archived.id,
      audience: 'all',
      memberId: null,
    })
  })

  test('writes member-scoped tombstones for a single-member audience', async () => {
    const space = await harness.createSpace()
    const audience = await harness.createMember(space.id)
    const hidden = await harness.createMember(space.id)

    await harness.db.transaction(async (tx: Tx) =>
      recordChanges(
        tx,
        space.id,
        {
          tombstones: [
            {
              entity: 'member',
              entityId: hidden.id,
              audience: { kind: 'member', memberId: audience.id },
            },
          ],
        },
        harness.clock.now(),
      ),
    )

    const tombstones = await tombstonesFor(space.id)
    expect(tombstones).toHaveLength(1)
    expect(tombstones[0]).toMatchObject({
      revision: 1n,
      entityId: hidden.id,
      audience: 'member',
      memberId: audience.id,
    })
  })

  test('assigns distinct revisions to concurrent transactions on the same space', async () => {
    const space = await harness.createSpace()
    const first = await harness.createMember(space.id)
    const second = await harness.createMember(space.id)

    const revisions = await Promise.all([
      harness.db.transaction(async (tx: Tx) =>
        recordChanges(
          tx,
          space.id,
          {
            writes: (revision) =>
              tx
                .update(members)
                .set({ name: 'First', revision, updatedAt: harness.clock.now() })
                .where(eq(members.id, first.id)),
          },
          harness.clock.now(),
        ),
      ),
      harness.db.transaction(async (tx: Tx) =>
        recordChanges(
          tx,
          space.id,
          {
            writes: (revision) =>
              tx
                .update(members)
                .set({ name: 'Second', revision, updatedAt: harness.clock.now() })
                .where(eq(members.id, second.id)),
          },
          harness.clock.now(),
        ),
      ),
    ])

    revisions.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    expect(revisions).toEqual([1n, 2n])

    const firstRow = await memberById(first.id)
    const secondRow = await memberById(second.id)
    expect(firstRow?.revision).not.toBe(secondRow?.revision)

    const spaceRow = await getSpaceById(harness.db, space.id)
    expect(spaceRow?.revision).toBe(2n)
  })

  test('rejects a member-scoped tombstone whose member belongs to another space', async () => {
    const space = await harness.createSpace()
    const otherSpace = await harness.createSpace()
    const otherMember = await harness.createMember(otherSpace.id)

    await expect(
      harness.db.transaction(async (tx: Tx) =>
        recordChanges(
          tx,
          space.id,
          {
            tombstones: [
              {
                entity: 'member',
                entityId: otherMember.id,
                audience: { kind: 'member', memberId: otherMember.id },
              },
            ],
          },
          harness.clock.now(),
        ),
      ),
    ).rejects.toThrow()
  })
})
