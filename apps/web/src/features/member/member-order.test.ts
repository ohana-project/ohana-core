import { describe, expect, it } from 'vitest'
import { orderedActiveMembers } from './member-order.ts'

/*
 * The stack's order (issue #62, shared with the spaces sheet and the
 * accounts rows, issue #64): the active members, the owner leading, then
 * the elders by creation — the store reads rows in key order, so the
 * order is this function's decision, not the storage's.
 */

function profile(
  id: string,
  role: 'owner' | 'regular',
  createdAt = '2026-08-12T10:00:00.000Z',
  archivedAt?: string,
) {
  return {
    id,
    name: 'Аня',
    role,
    createdAt,
    ...(archivedAt ? { archivedAt } : {}),
  }
}

const ANYA = '01900000-0000-7000-8000-000000000001'
const DIMA = '01900000-0000-7000-8000-000000000002'
const MISHA = '01900000-0000-7000-8000-000000000003'

describe('orderedActiveMembers', () => {
  it('leads with the owner and orders the rest by creation', () => {
    const ordered = orderedActiveMembers([
      profile(MISHA, 'regular', '2026-09-01T10:00:00.000Z'),
      profile(ANYA, 'owner', '2026-09-02T10:00:00.000Z'),
      profile(DIMA, 'regular', '2026-08-12T10:00:00.000Z'),
    ])
    expect(ordered.map((member) => member.id)).toEqual([ANYA, DIMA, MISHA])
  })

  it('drops archived members', () => {
    const ordered = orderedActiveMembers([
      profile(ANYA, 'owner'),
      profile(DIMA, 'regular', '2026-08-12T10:00:00.000Z', '2026-09-01T10:00:00.000Z'),
    ])
    expect(ordered.map((member) => member.id)).toEqual([ANYA])
  })

  it('breaks creation ties by id', () => {
    const ordered = orderedActiveMembers([
      profile(DIMA, 'regular', '2026-08-12T10:00:00.000Z'),
      profile(MISHA, 'regular', '2026-08-12T10:00:00.000Z'),
    ])
    expect(ordered.map((member) => member.id)).toEqual([DIMA, MISHA])
  })
})
