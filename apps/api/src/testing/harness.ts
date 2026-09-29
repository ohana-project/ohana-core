import { type AppDeps, buildApp } from '../app/buildApp.ts'
import { insertMember } from '../modules/members/repository.ts'
import type { Member } from '../modules/members/tables.ts'
import type { Space } from '../modules/spaces/index.ts'
import { createSpace } from '../modules/spaces/index.ts'
import { recordChanges } from '../modules/sync/index.ts'
import type { FixedClock } from '../platform/clock.ts'
import { fixedClock } from '../platform/clock.ts'
import { createDb, type Db, type Tx } from '../platform/db/index.ts'
import { createSilentLogger } from '../platform/logging.ts'
import { createS3Storage, type ObjectStorageWithSetup } from '../platform/storage/s3.ts'

export interface TestEnvironment {
  databaseUrl: string
  storageEndpoint: string
  storageAccessKey: string
  storageSecretKey: string
  storageBucket: string
}

export function readTestEnvironment(): TestEnvironment {
  const values = {
    databaseUrl: process.env.OHANA_TEST_DATABASE_URL,
    storageEndpoint: process.env.OHANA_TEST_STORAGE_ENDPOINT,
    storageAccessKey: process.env.OHANA_TEST_STORAGE_ACCESS_KEY,
    storageSecretKey: process.env.OHANA_TEST_STORAGE_SECRET_KEY,
    storageBucket: process.env.OHANA_TEST_STORAGE_BUCKET,
  }
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value.length === 0) {
      throw new Error(
        `Test environment variable for ${name} is missing; the global setup did not run`,
      )
    }
  }
  return values as TestEnvironment
}

let factoryCounter = 0

export interface TestHarness {
  db: Db
  clock: FixedClock
  storage: ObjectStorageWithSetup
  createSpace(input?: { name?: string }): Promise<Space>
  createMember(
    spaceId: string,
    input?: { name?: string; role?: 'owner' | 'regular' },
  ): Promise<Member>
  buildTestApp(overrides?: Partial<AppDeps>): ReturnType<typeof buildApp>
  close(): Promise<void>
}

export async function createTestHarness(): Promise<TestHarness> {
  const environment = readTestEnvironment()
  const { db, close } = createDb(environment.databaseUrl)
  const clock = fixedClock()
  const storage = createS3Storage({
    endpoint: environment.storageEndpoint,
    region: 'us-east-1',
    accessKeyId: environment.storageAccessKey,
    secretAccessKey: environment.storageSecretKey,
    bucket: environment.storageBucket,
  })
  const deps: AppDeps = { db, clock, storage, logger: createSilentLogger() }

  return {
    db,
    clock,
    storage,
    createSpace: (input) =>
      createSpace({ db, clock }, { name: input?.name ?? `Space ${++factoryCounter}` }),
    createMember: (spaceId, input) =>
      db.transaction(async (tx: Tx) => {
        let created: Member | undefined
        await recordChanges(
          tx,
          spaceId,
          {
            writes: async (writeTx: Tx, revision: bigint) => {
              created = await insertMember(writeTx, spaceId, {
                name: input?.name ?? `Member ${++factoryCounter}`,
                role: input?.role ?? 'regular',
                revision,
                now: clock.now(),
              })
            },
          },
          clock.now(),
        )
        if (created === undefined) throw new Error('Member factory produced no row')
        return created
      }),
    buildTestApp: (overrides) => buildApp({ ...deps, ...overrides }),
    close,
  }
}
