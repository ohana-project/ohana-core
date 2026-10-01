import { randomUUID } from 'node:crypto'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import { eq, sql } from 'drizzle-orm'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { createTestHarness, type TestHarness } from '../../testing/harness.ts'
import { type AccessDeps, memberSessionGuard, requireMemberActor } from '../access/index.ts'
import {
  ADMIN_MARKER_HEADER,
  ADMIN_SESSION_COOKIE,
  ensureInitialAdministrator,
} from '../admin/index.ts'
import { administrators, adminSessions } from '../admin/tables.ts'
import { findMemberInSpace } from '../members/index.ts'
import { recordChanges } from '../sync/index.ts'
import { requireVisibleSectionInTx, sectionGate } from './index.ts'
import { spaces } from './tables.ts'

const harness: TestHarness = await createTestHarness()
afterAll(async () => {
  await harness.close()
})

const ADMIN_PASSWORD = 'sections-admin-password'

/*
 * The administrator is a singleton, so each file that signs in re-establishes
 * it in its arrange step; test files run one at a time (vitest.config.ts).
 */
await harness.db.delete(adminSessions)
await harness.db.delete(administrators)
await ensureInitialAdministrator(harness, ADMIN_PASSWORD)

type TestApp = ReturnType<TestHarness['buildTestApp']>

async function withApp(body: (app: TestApp) => Promise<void>) {
  const app = harness.buildTestApp()
  await app.ready()
  try {
    await body(app)
  } finally {
    await app.close()
  }
}

async function signInAdmin(app: TestApp): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/session',
    payload: { password: ADMIN_PASSWORD },
    headers: { [ADMIN_MARKER_HEADER]: '1' },
  })
  expect(response.statusCode).toBe(204)
  const cookie = response.cookies.find((candidate) => candidate.name === ADMIN_SESSION_COOKIE)
  if (cookie === undefined) throw new Error('Sign-in set no administrative session cookie')
  return `${ADMIN_SESSION_COOKIE}=${cookie.value}`
}

async function issueCode(app: TestApp, cookie: string, spaceId: string, memberId: string) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/spaces/${spaceId}/members/${memberId}/access-codes`,
    headers: { cookie, [ADMIN_MARKER_HEADER]: '1' },
  })
  expect(response.statusCode).toBe(201)
  return response.json() as Promise<{ id: string; code: string }>
}

interface MemberSession {
  memberId: string
  cookie: string
}

/** Redeems the code and returns the session the response cookie names. */
async function signInMember(app: TestApp, code: string): Promise<MemberSession> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/access-codes/redeem',
    payload: { code },
  })
  expect(response.statusCode).toBe(200)
  const cookie = response.cookies.find((candidate) =>
    candidate.name.startsWith('ohana_member_session_'),
  )
  if (cookie === undefined) throw new Error('Redemption produced no session cookie')
  return {
    memberId: cookie.name.slice('ohana_member_session_'.length),
    cookie: `${cookie.name}=${cookie.value}`,
  }
}

function memberHeaders(session: MemberSession) {
  return { 'x-ohana-member': session.memberId, cookie: session.cookie }
}

async function spaceRevision(spaceId: string): Promise<bigint> {
  const rows = await harness.db.select().from(spaces).where(eq(spaces.id, spaceId))
  const row = rows[0]
  if (row === undefined) throw new Error('The space row disappeared')
  return row.revision
}

/*
 * The test-only section storage: a stand-in for the journal's table until
 * that module arrives (issue #14 and later). It lives only in the run's
 * throwaway database.
 */
interface ScratchRow {
  [column: string]: unknown
  space_id: string
  id: string
  body: string
}

await harness.db.execute(sql`
  create table if not exists section_gate_scratch (
    space_id uuid not null,
    id uuid not null primary key,
    body text not null
  )
`)

async function countScratchRows(spaceId: string): Promise<number> {
  const result = await harness.db.execute<ScratchRow>(
    sql`select space_id, id, body from section_gate_scratch where space_id = ${spaceId}`,
  )
  return result.rows.length
}

/**
 * Mounts the stand-in journal route exactly the way a section module will:
 * the access module's member session guard, then the spaces module's one
 * section gate, then thin handlers whose write rechecks visibility inside
 * its transaction, after taking the space row lock.
 */
function registerJournalStandIn(app: TestApp) {
  const accessDeps: AccessDeps = {
    db: harness.db,
    clock: harness.clock,
    findMemberInSpace: (executor, spaceId, memberId) =>
      findMemberInSpace(executor, spaceId, memberId),
  }
  app.register(
    async (section) => {
      const scoped = section.withTypeProvider<TypeBoxTypeProvider>()
      scoped.addHook('onRequest', memberSessionGuard(accessDeps))
      scoped.addHook('onRequest', sectionGate({ db: harness.db }, 'journal'))

      scoped.get('/journal', async (request) => {
        const actor = requireMemberActor(request)
        const result = await harness.db.execute<ScratchRow>(
          sql`select space_id, id, body from section_gate_scratch where space_id = ${actor.spaceId}`,
        )
        return result.rows.map((row) => ({ id: row.id, body: row.body }))
      })

      scoped.post(
        '/journal',
        { schema: { body: Type.Object({ body: Type.String() }) } },
        async (request, reply) => {
          const actor = requireMemberActor(request)
          const barrier = writeBarrier
          if (barrier !== undefined) {
            barrier.park()
            await barrier.held
          }
          let rowId: string | undefined
          await harness.db.transaction(async (tx) => {
            await requireVisibleSectionInTx(tx, actor.spaceId, 'journal')
            await recordChanges(
              tx,
              actor.spaceId,
              {
                writes: async (writeTx) => {
                  rowId = randomUUID()
                  await writeTx.execute(sql`
                    insert into section_gate_scratch (space_id, id, body)
                    values (${actor.spaceId}, ${rowId}, ${request.body.body})
                  `)
                },
              },
              harness.clock.now(),
            )
          })
          if (rowId === undefined) throw new Error('The stand-in write produced no row id')
          return reply.code(201).send({ id: rowId })
        },
      )
    },
    { prefix: '/api/v1' },
  )
}

/*
 * A test can park the stand-in's write after the gate has passed, arrange
 * a concurrent change, and release it: the interleaving the
 * in-transaction recheck exists for.
 */
interface WriteBarrier {
  /** Resolves when the handler has passed the gate and is parked. */
  park: () => void
  /** The handler waits on this before starting its transaction. */
  held: Promise<void>
  release: () => void
}

let writeBarrier: WriteBarrier | undefined

async function withJournalApp(body: (app: TestApp) => Promise<void>) {
  const app = harness.buildTestApp()
  registerJournalStandIn(app)
  await app.ready()
  try {
    await body(app)
  } finally {
    await app.close()
  }
}

/** Changes one section's visibility as the owner of the space. */
async function setSectionVisible(
  app: TestApp,
  session: MemberSession,
  section: 'journal' | 'calendar' | 'wishlist',
  visible: boolean,
): Promise<void> {
  const response = await app.inject({
    method: 'PATCH',
    url: '/api/v1/space',
    headers: memberHeaders(session),
    payload: { sections: { [section]: visible } },
  })
  expect(response.statusCode).toBe(200)
}

describe('GET /api/v1/space (the sections a member sees)', () => {
  test('a member reads their space with every section visible by default', async () => {
    const space = await harness.createSpace({ name: 'Наша семья' })
    const regular = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, regular.id)).code,
      )

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/space',
        headers: memberHeaders(session),
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        id: space.id,
        name: 'Наша семья',
        timezone: 'UTC',
        sections: { journal: true, calendar: true, wishlist: true },
      })
    })
  })
})

describe('PATCH /api/v1/space (the owner toggles section visibility)', () => {
  test('hiding the journal hides it from members and advances the revision', async () => {
    const space = await harness.createSpace({ name: 'Наша семья' })
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const before = await spaceRevision(space.id)
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, owner.id)).code,
      )

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(session),
        payload: { sections: { journal: false } },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        id: space.id,
        name: 'Наша семья',
        timezone: 'UTC',
        sections: { journal: false, calendar: true, wishlist: true },
      })
    })
    expect(await spaceRevision(space.id)).toBe(before + 1n)
  })

  test('showing the section again restores it and advances the revision again', async () => {
    const space = await harness.createSpace({ name: 'Наша семья' })
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const before = await spaceRevision(space.id)
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, owner.id)).code,
      )
      const headers = memberHeaders(session)

      const hide = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers,
        payload: { sections: { wishlist: false } },
      })
      expect(hide.statusCode).toBe(200)

      const show = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers,
        payload: { sections: { wishlist: true } },
      })
      expect(show.statusCode).toBe(200)
      expect(show.json()).toEqual({
        id: space.id,
        name: 'Наша семья',
        timezone: 'UTC',
        sections: { journal: true, calendar: true, wishlist: true },
      })
    })
    // Two real changes, two revisions.
    expect(await spaceRevision(space.id)).toBe(before + 2n)
  })

  test('a patch that changes no visibility spends no revision', async () => {
    const space = await harness.createSpace({ name: 'Наша семья' })
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const before = await spaceRevision(space.id)
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, owner.id)).code,
      )

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(session),
        payload: { sections: { calendar: true } },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        id: space.id,
        name: 'Наша семья',
        timezone: 'UTC',
        sections: { journal: true, calendar: true, wishlist: true },
      })
    })
    // The no-op answered from the stored row, like the time-zone no-op.
    expect(await spaceRevision(space.id)).toBe(before)
  })

  test('an empty patch and an empty sections change fail validation', async () => {
    const space = await harness.createSpace({ name: 'Наша семья' })
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, owner.id)).code,
      )
      const headers = memberHeaders(session)

      const empty = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers,
        payload: {},
      })
      expect(empty.statusCode).toBe(400)
      expect(empty.json().error.code).toBe('validation_failed')

      const noSection = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers,
        payload: { sections: {} },
      })
      expect(noSection.statusCode).toBe(400)
      expect(noSection.json().error.code).toBe('validation_failed')
    })
  })

  test('a regular member cannot toggle visibility', async () => {
    const space = await harness.createSpace({ name: 'Наша семья' })
    const regular = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, regular.id)).code,
      )

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(session),
        payload: { sections: { journal: false } },
      })
      expect(response.statusCode).toBe(403)
      expect(response.json().error.code).toBe('owner_required')
    })
  })

  test('an owner toggles visibility and the default time zone in one patch', async () => {
    const space = await harness.createSpace({ name: 'Наша семья' })
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const before = await spaceRevision(space.id)
    await withApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, owner.id)).code,
      )

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/space',
        headers: memberHeaders(session),
        payload: { sections: { calendar: false }, timezone: 'Asia/Novosibirsk' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        id: space.id,
        name: 'Наша семья',
        timezone: 'Asia/Novosibirsk',
        sections: { journal: true, calendar: false, wishlist: true },
      })
    })
    // One patch, one revision: the change is one transaction.
    expect(await spaceRevision(space.id)).toBe(before + 1n)
  })
})

describe('the section gate (a stand-in journal route until the section modules arrive)', () => {
  test('a section route without a member session answers 401', async () => {
    await withJournalApp(async (app) => {
      const read = await app.inject({ method: 'GET', url: '/api/v1/journal' })
      expect(read.statusCode).toBe(401)
      expect(read.json().error.code).toBe('unauthorized')
    })
  })

  test('reads and writes pass while the section is visible', async () => {
    const space = await harness.createSpace({ name: 'Наша семья' })
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const regular = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    await withJournalApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const ownerSession = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, owner.id)).code,
      )
      const regularSession = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, regular.id)).code,
      )

      const written = await app.inject({
        method: 'POST',
        url: '/api/v1/journal',
        headers: memberHeaders(ownerSession),
        payload: { body: 'Первая запись' },
      })
      expect(written.statusCode).toBe(201)

      // A regular member reads the same section under the normal
      // permissions — visibility is the only thing the gate decides.
      const read = await app.inject({
        method: 'GET',
        url: '/api/v1/journal',
        headers: memberHeaders(regularSession),
      })
      expect(read.statusCode).toBe(200)
      expect(read.json()).toEqual([{ id: expect.any(String), body: 'Первая запись' }])
    })
  })

  test('a hidden section rejects reads and writes with 404 section_hidden', async () => {
    const space = await harness.createSpace({ name: 'Наша семья' })
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    const regular = await harness.createMember(space.id, { name: 'Дима', role: 'regular' })
    await withJournalApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const ownerSession = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, owner.id)).code,
      )
      const regularSession = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, regular.id)).code,
      )

      await setSectionVisible(app, ownerSession, 'journal', false)

      // The gate serves every member of the space, owners included: a
      // hidden section does not exist for anyone on the member side.
      const ownerRead = await app.inject({
        method: 'GET',
        url: '/api/v1/journal',
        headers: memberHeaders(ownerSession),
      })
      expect(ownerRead.statusCode).toBe(404)
      expect(ownerRead.json().error.code).toBe('section_hidden')

      const regularRead = await app.inject({
        method: 'GET',
        url: '/api/v1/journal',
        headers: memberHeaders(regularSession),
      })
      expect(regularRead.statusCode).toBe(404)
      expect(regularRead.json().error.code).toBe('section_hidden')

      const write = await app.inject({
        method: 'POST',
        url: '/api/v1/journal',
        headers: memberHeaders(ownerSession),
        payload: { body: 'не должно пройти' },
      })
      expect(write.statusCode).toBe(404)
      expect(write.json().error.code).toBe('section_hidden')
    })
  })

  test('hiding keeps the section data, and showing restores access to it', async () => {
    const space = await harness.createSpace({ name: 'Наша семья' })
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await withJournalApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, owner.id)).code,
      )

      const written = await app.inject({
        method: 'POST',
        url: '/api/v1/journal',
        headers: memberHeaders(session),
        payload: { body: 'береги запись' },
      })
      expect(written.statusCode).toBe(201)

      await setSectionVisible(app, session, 'journal', false)
      // The row survives the hiding: the setting gates access, not storage.
      expect(await countScratchRows(space.id)).toBe(1)

      await setSectionVisible(app, session, 'journal', true)

      const read = await app.inject({
        method: 'GET',
        url: '/api/v1/journal',
        headers: memberHeaders(session),
      })
      expect(read.statusCode).toBe(200)
      expect(read.json()).toEqual([{ id: expect.any(String), body: 'береги запись' }])
    })
  })

  test('a hide that commits after the gate still stops the write', async () => {
    const space = await harness.createSpace({ name: 'Наша семья' })
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await withJournalApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, owner.id)).code,
      )

      // The write passes the gate, then parks; the owner hides the journal
      // in that window, and the write's in-transaction recheck sees it.
      let park!: () => void
      let release!: () => void
      const parked = new Promise<void>((resolveParked) => {
        park = resolveParked
      })
      const held = new Promise<void>((resolveRelease) => {
        release = resolveRelease
      })
      writeBarrier = { park, held, release }
      try {
        const pendingWrite = app.inject({
          method: 'POST',
          url: '/api/v1/journal',
          headers: memberHeaders(session),
          payload: { body: 'опоздало' },
        })
        await parked
        await setSectionVisible(app, session, 'journal', false)
        release()

        const written = await pendingWrite
        expect(written.statusCode).toBe(404)
        expect(written.json().error.code).toBe('section_hidden')
        expect(await countScratchRows(space.id)).toBe(0)
      } finally {
        release()
        writeBarrier = undefined
      }
    })
  })

  test('the write waits for a hide that is still in flight and then refuses', async () => {
    const space = await harness.createSpace({ name: 'Наша семья' })
    const owner = await harness.createMember(space.id, { name: 'Аня', role: 'owner' })
    await withJournalApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const session = await signInMember(
        app,
        (await issueCode(app, adminCookie, space.id, owner.id)).code,
      )

      // A hide that has locked the space row but not committed yet. The
      // gate reads the last committed state and passes; the write's
      // in-transaction check blocks on the space row lock and decides only
      // after the hide commits — a plain read would decide from the
      // pre-hide snapshot, queue later at the revision bump, and write.
      let commitHide!: () => void
      const hideCommitted = new Promise<void>((resolve) => {
        commitHide = resolve
      })
      const hideTx = harness.db.transaction(async (tx) => {
        await tx
          .update(spaces)
          .set({
            journalVisible: false,
            revision: sql`${spaces.revision} + 1`,
            updatedAt: harness.clock.now(),
          })
          .where(eq(spaces.id, space.id))
        await hideCommitted
      })

      let pendingWrite:
        | Promise<{
            statusCode: number
            json: () => { error?: { code?: string } }
          }>
        | undefined
      try {
        pendingWrite = app.inject({
          method: 'POST',
          url: '/api/v1/journal',
          headers: memberHeaders(session),
          payload: { body: 'ждёт блокировку' },
        })
        // The write is queued on the hide's row lock: a row lock waiter
        // shows as an ungranted transactionid lock, and the hide is the
        // only other transaction in this test.
        await vi.waitFor(
          async () => {
            const result = await harness.db.execute(sql`
              select 1 from pg_locks
              where locktype = 'transactionid' and not granted
              limit 1
            `)
            if (result.rows.length === 0) throw new Error('The write is not waiting yet')
          },
          { timeout: 10_000, interval: 25 },
        )
        commitHide()
        await hideTx

        const written = await pendingWrite
        expect(written.statusCode).toBe(404)
        expect(written.json().error?.code).toBe('section_hidden')
        expect(await countScratchRows(space.id)).toBe(0)
      } finally {
        commitHide()
        await hideTx.catch(() => {})
        await pendingWrite?.catch(() => {})
      }
    })
  })

  test('the gate follows the actor: another space keeps its visible section', async () => {
    const hidden = await harness.createSpace({ name: 'Скрытый журнал' })
    const visible = await harness.createSpace({ name: 'Видимый журнал' })
    const hiddenOwner = await harness.createMember(hidden.id, { name: 'Аня', role: 'owner' })
    const visibleMember = await harness.createMember(visible.id, { name: 'Дима', role: 'regular' })
    await withJournalApp(async (app) => {
      const adminCookie = await signInAdmin(app)
      const hiddenSession = await signInMember(
        app,
        (await issueCode(app, adminCookie, hidden.id, hiddenOwner.id)).code,
      )
      const visibleSession = await signInMember(
        app,
        (await issueCode(app, adminCookie, visible.id, visibleMember.id)).code,
      )

      await setSectionVisible(app, hiddenSession, 'journal', false)

      const refused = await app.inject({
        method: 'GET',
        url: '/api/v1/journal',
        headers: memberHeaders(hiddenSession),
      })
      expect(refused.statusCode).toBe(404)

      const allowed = await app.inject({
        method: 'GET',
        url: '/api/v1/journal',
        headers: memberHeaders(visibleSession),
      })
      expect(allowed.statusCode).toBe(200)
      expect(allowed.json()).toEqual([])
    })
  })
})
