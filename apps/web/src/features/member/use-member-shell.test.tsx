import { screen } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { applySyncResult, type SyncResult } from '@/data/local-store.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { useMemberShell } from './use-member-shell.ts'

/*
 * One place builds the member shell's data (issue #62): the space with
 * the first two active members' monograms and the member-count line,
 * the visible sections, the sync state and the user menu — the same
 * shapes every member area passes to the layout, so no area passes an
 * empty monogram list and the top bar shows the same stack everywhere.
 */

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
}))

const navigate = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

const SPACE_ID = '01900000-0000-7000-8000-00000000000a'
const ANYA = '01900000-0000-7000-8000-000000000001'
const DIMA = '01900000-0000-7000-8000-000000000002'
const MISHA = '01900000-0000-7000-8000-000000000003'
const LUDA = '01900000-0000-7000-8000-000000000004'

function meResponse(role: 'owner' | 'regular') {
  return {
    member: {
      id: ANYA,
      name: 'Аня',
      displayName: 'Аня Смирнова',
      role,
      createdAt: '2026-08-12T10:00:00.000Z',
    },
    space: { id: SPACE_ID, name: 'Наша семья' },
    needsOnboarding: false,
  }
}

function mockMe(role: 'owner' | 'regular' = 'owner') {
  vi.mocked(api.GET).mockImplementation(async (path: never) => {
    if (path === '/api/v1/me') {
      return {
        data: meResponse(role),
        error: undefined,
        response: new Response(null, { status: 200 }),
      }
    }
    throw new Error(`Unexpected GET ${String(path)}`)
  })
}

function seedRegistry(memberId = ANYA) {
  window.localStorage.setItem(
    'ohana.sessions',
    JSON.stringify([
      {
        memberId,
        spaceId: SPACE_ID,
        spaceName: 'Наша семья',
        name: 'Аня',
        displayName: 'Аня Смирнова',
      },
    ]),
  )
  window.localStorage.setItem('ohana.activeMember', memberId)
}

function syncResultWith(members: SyncResult['changes'][number][]): SyncResult {
  return {
    revision: '7',
    changes: [
      {
        entity: 'space',
        space: {
          id: SPACE_ID,
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

function member(id: string, name: string, role: 'owner' | 'regular', archivedAt?: string) {
  return {
    entity: 'member' as const,
    member: {
      id,
      name,
      role,
      createdAt: '2026-08-12T10:00:00.000Z',
      ...(archivedAt ? { archivedAt } : {}),
    },
  }
}

function Probe() {
  const shell = useMemberShell()
  // The marks render only once the session probe and the partition read
  // have settled, so the waits below wait for data, not for the element.
  if (shell.space.marks.length === 0) return null
  return (
    <div>
      <span data-testid="name">{shell.space.name}</span>
      <span data-testid="label">{shell.space.membersLabel ?? '—'}</span>
      <span data-testid="marks">{shell.space.marks.map((mark) => mark.initials).join('')}</span>
      <span data-testid="sections">{shell.sections.map((section) => section.id).join(',')}</span>
      <span data-testid="sync">{shell.sync?.state ?? 'none'}</span>
      <span data-testid="menu">{shell.userMenuItems.map((item) => item.id).join(',')}</span>
    </div>
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

describe('useMemberShell', () => {
  it('builds the space from the first two active members with the count line', async () => {
    seedRegistry()
    mockMe('owner')
    // Four members in the demo world, Люда archived: the stack shows the
    // first two active monograms, the line counts the active three.
    await applySyncResult(
      ANYA,
      syncResultWith([
        member(ANYA, 'Аня', 'owner'),
        member(DIMA, 'Дима', 'regular'),
        member(MISHA, 'Миша', 'regular'),
        member(LUDA, 'Люда', 'regular', '2026-09-01T10:00:00.000Z'),
      ]),
    )
    renderWithProviders(<Probe />)

    await vi.waitFor(() => expect(screen.getByTestId('marks')).toHaveTextContent('АД'))
    expect(screen.getByTestId('label')).toHaveTextContent('3 участника · вы владелец')
    expect(screen.getByTestId('name')).toHaveTextContent('Наша семья')
  })

  it('an archived member never rides the stack even in the first two seats', async () => {
    seedRegistry()
    mockMe('owner')
    await applySyncResult(
      ANYA,
      syncResultWith([
        member(ANYA, 'Аня', 'owner'),
        member(DIMA, 'Дима', 'regular', '2026-09-01T10:00:00.000Z'),
        member(MISHA, 'Миша', 'regular'),
      ]),
    )
    renderWithProviders(<Probe />)

    await vi.waitFor(() => expect(screen.getByTestId('marks')).toHaveTextContent('АМ'))
    expect(screen.getByTestId('label')).toHaveTextContent('2 участника · вы владелец')
  })

  it('a regular member’s count line carries no owner note', async () => {
    seedRegistry()
    mockMe('regular')
    await applySyncResult(
      ANYA,
      syncResultWith([member(ANYA, 'Аня', 'owner'), member(DIMA, 'Дима', 'regular')]),
    )
    renderWithProviders(<Probe />)

    await vi.waitFor(() => expect(screen.getByTestId('label')).toHaveTextContent(/^2 участника$/))
    expect(screen.getByTestId('label').textContent).not.toContain('владелец')
  })

  it('a device with nothing downloaded shows the signed-in member alone and no count line', async () => {
    seedRegistry()
    mockMe('owner')
    renderWithProviders(<Probe />)

    // The stack is never empty (no area passes an empty list): the one
    // member the registry names stands in until the first sync lands.
    expect(await screen.findByTestId('marks')).toHaveTextContent('А')
    expect(screen.getByTestId('label')).toHaveTextContent('—')
    expect(screen.getByTestId('name')).toHaveTextContent('Наша семья')
  })

  it('carries the visible sections, the sync state and the user menu', async () => {
    seedRegistry()
    mockMe('owner')
    await applySyncResult(
      ANYA,
      syncResultWith([member(ANYA, 'Аня', 'owner'), member(DIMA, 'Дима', 'regular')]),
    )
    renderWithProviders(<Probe />)

    expect(await screen.findByTestId('sections')).toHaveTextContent(
      'home,journal,calendar,wishlist',
    )
    // The engine has not run under the probe: no chip yet — the state is
    // the layout's to render, the pass-through is the screens' tests'.
    expect(screen.getByTestId('sync')).toHaveTextContent('none')
    expect(screen.getByTestId('menu')).toHaveTextContent('members')
    expect(screen.getByTestId('menu')).toHaveTextContent('sign-out')
  })
})
