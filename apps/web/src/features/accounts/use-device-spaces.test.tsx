import { screen } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { applySyncResult, type SyncResult } from '@/data/local-store.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { useDeviceSpaces } from './use-device-spaces.ts'

/*
 * One row of data per sign-in kept on this device (issue #64): the sheet
 * and the accounts rows both read this one hook, so their rows can never
 * disagree. The stack and the count line are each partition's own — a
 * space whose partition was never downloaded names its signed-in member
 * instead of inventing a count (ADR-0002, the sidebar line's honesty).
 */

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
}))

const FAMILY_ID = '01900000-0000-7000-8000-00000000000a'
const DACHA_ID = '01900000-0000-7000-8000-00000000000b'
const ANYA = '01900000-0000-7000-8000-000000000001'
const DACHA_ANYA = '01900000-0000-7000-8000-000000000002'
const DIMA = '01900000-0000-7000-8000-000000000003'
const MISHA = '01900000-0000-7000-8000-000000000004'

function seedRegistry() {
  window.localStorage.setItem(
    'ohana.sessions',
    JSON.stringify([
      {
        memberId: ANYA,
        spaceId: FAMILY_ID,
        spaceName: 'Наша семья',
        name: 'Аня',
        displayName: 'Аня Смирнова',
      },
      {
        memberId: DACHA_ANYA,
        spaceId: DACHA_ID,
        spaceName: 'Аня и родители',
        name: 'Аня',
      },
    ]),
  )
  window.localStorage.setItem('ohana.activeMember', ANYA)
}

function syncResultWith(members: SyncResult['changes'][number][]): SyncResult {
  return {
    revision: '7',
    changes: [
      {
        entity: 'space',
        space: {
          id: FAMILY_ID,
          name: 'Наша семья',
          timezone: 'Europe/Moscow',
          sections: { journal: true, calendar: true, wishlist: true },
        },
      },
      ...members,
    ],
    tombstones: [],
  }
}

function member(id: string, name: string, role: 'owner' | 'regular', createdAt: string) {
  return { entity: 'member' as const, member: { id, name, role, createdAt } }
}

function Probe() {
  const spaces = useDeviceSpaces()
  return (
    <ul>
      {spaces.map((space) => (
        <li key={space.session.memberId} data-testid={space.session.spaceName}>
          <span data-testid="active">{space.active ? 'yes' : 'no'}</span>
          <span data-testid="marks">{space.marks.map((mark) => mark.initials).join('')}</span>
          <span data-testid="label">{space.membersLabel ?? '—'}</span>
          <span data-testid="synced">{space.syncedAt === undefined ? 'never' : 'known'}</span>
        </li>
      ))}
    </ul>
  )
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  window.localStorage.clear()
  vi.clearAllMocks()
})

afterEach(async () => {
  const names = await globalThis.indexedDB.databases()
  for (const name of names) {
    if (name.name !== undefined) globalThis.indexedDB.deleteDatabase(name.name)
  }
})

describe('useDeviceSpaces', () => {
  it('builds one row per retained sign-in, marks and count line from each partition', async () => {
    seedRegistry()
    // Only «Наша семья» was ever downloaded on this device.
    await applySyncResult(
      ANYA,
      syncResultWith([
        member(ANYA, 'Аня', 'owner', '2026-08-12T10:00:00.000Z'),
        member(DIMA, 'Дима', 'regular', '2026-08-13T10:00:00.000Z'),
        member(MISHA, 'Миша', 'regular', '2026-08-14T10:00:00.000Z'),
      ]),
    )
    renderWithProviders(<Probe />)

    const family = screen.getByTestId('Наша семья')
    const dacha = screen.getByTestId('Аня и родители')
    await vi.waitFor(() => {
      expect(family.querySelector('[data-testid=marks]')).toHaveTextContent('АДМ')
      expect(dacha.querySelector('[data-testid=marks]')).toHaveTextContent('А')
    })
    expect(family.querySelector('[data-testid=active]')).toHaveTextContent('yes')
    expect(dacha.querySelector('[data-testid=active]')).toHaveTextContent('no')
    // The downloaded partition answers the count line; the other one names
    // its signed-in member instead (the fallback the rows render).
    expect(family.querySelector('[data-testid=label]')).toHaveTextContent(
      '3 участника · вы владелец',
    )
    expect(dacha.querySelector('[data-testid=label]')).toHaveTextContent('—')
    expect(family.querySelector('[data-testid=synced]')).toHaveTextContent('known')
    expect(dacha.querySelector('[data-testid=synced]')).toHaveTextContent('never')
  })

  it('a regular viewer’s line carries no owner note', async () => {
    // The probe (offline, from the partition's own row) and the partition
    // agree: Аня is regular here, the line must not dress her as owner.
    seedRegistry()
    await applySyncResult(
      ANYA,
      syncResultWith([
        member(DIMA, 'Дима', 'owner', '2026-08-12T10:00:00.000Z'),
        member(ANYA, 'Аня', 'regular', '2026-08-13T10:00:00.000Z'),
      ]),
    )
    renderWithProviders(<Probe />)

    await vi.waitFor(() =>
      expect(
        screen.getByTestId('Наша семья').querySelector('[data-testid=label]'),
      ).toHaveTextContent(/^2 участника$/),
    )
  })

  it('the active row’s owner note follows the probe, like the sidebar’s line', async () => {
    // The probe says owner while the downloaded partition still says
    // regular: the sheet's open row and the sidebar's line answer "am I
    // the owner" with one word (use-member-shell.ts), so the note stays.
    seedRegistry()
    vi.mocked(api.GET).mockImplementation(async (path: never) => {
      if (path === '/api/v1/me') {
        return {
          data: {
            member: {
              id: ANYA,
              name: 'Аня',
              displayName: 'Аня Смирнова',
              role: 'owner',
              createdAt: '2026-08-12T10:00:00.000Z',
            },
            space: { id: FAMILY_ID, name: 'Наша семья' },
            needsOnboarding: false,
          },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    await applySyncResult(
      ANYA,
      syncResultWith([
        member(DIMA, 'Дима', 'owner', '2026-08-12T10:00:00.000Z'),
        member(ANYA, 'Аня', 'regular', '2026-08-13T10:00:00.000Z'),
      ]),
    )
    renderWithProviders(<Probe />)

    await vi.waitFor(() =>
      expect(
        screen.getByTestId('Наша семья').querySelector('[data-testid=label]'),
      ).toHaveTextContent('2 участника · вы владелец'),
    )
  })

  it('keeps the registry’s sign-in order and answers honestly with an empty registry', () => {
    window.localStorage.setItem('ohana.sessions', '[]')
    renderWithProviders(<Probe />)

    expect(document.querySelectorAll('li')).toHaveLength(0)
  })
})
