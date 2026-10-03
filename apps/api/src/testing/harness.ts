import { type AppDeps, buildApp } from '../app/buildApp.ts'
import { insertMember } from '../modules/members/repository.ts'
import type { Member } from '../modules/members/tables.ts'
import type { Space } from '../modules/spaces/index.ts'
import { createSpace } from '../modules/spaces/index.ts'
import { recordChanges } from '../modules/sync/index.ts'
import type { FixedClock } from '../platform/clock.ts'
import { fixedClock } from '../platform/clock.ts'
import { createDb, type Db, type Tx } from '../platform/db/index.ts'
import type { JobSender, JobSubmission } from '../platform/jobs/index.ts'
import { createSilentLogger } from '../platform/logging.ts'
import type {
  PushCredentials,
  PushPayload,
  PushSender,
  PushSendResult,
  VapidKeys,
} from '../platform/push/index.ts'
import { generateVapidKeys } from '../platform/push/webpush.ts'
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

/**
 * The recording jobs port the harness wires by default: every submission is
 * kept for the test's assertions, and nothing reaches a queue. The real
 * pg-boss is exercised by the queue's own integration tests and by
 * buildWorker's, which build it over the same test database.
 */
export interface RecordingJobSender extends JobSender {
  submissions: JobSubmission[]
}

export function recordingJobSender(): RecordingJobSender {
  const sender: RecordingJobSender = {
    submissions: [],
    async sendInTx(tx: Tx, submission: JobSubmission) {
      void tx
      sender.submissions.push(submission)
    },
  }
  return sender
}

/**
 * The recording push port the harness wires by default (issue #22): every
 * send is kept for the test's assertions and answered by the script the
 * test sets — delivered unless told otherwise. The real Web Push sender is
 * exercised by the platform's own tests, which mock only the transport.
 */
export interface RecordingPushSender extends PushSender {
  sends: Array<{ credentials: PushCredentials; payload: PushPayload }>
  /** The answer the next sends give, until changed. */
  respondWith(
    result:
      | PushSendResult
      | ((credentials: PushCredentials, payload: PushPayload) => PushSendResult),
  ): void
}

/**
 * A db whose Nth transaction rejects — the seam for pinning a handler's
 * failure ordering (the receipt before the cleanup, the prune riding the
 * aggregate) without mocking the queries inside those transactions.
 */
export function dbFailingOnNthTransaction(
  db: Db,
  n: number,
  mode: 'exactly' | 'from' = 'exactly',
): Db {
  let calls = 0
  const failing = {
    transaction: <T>(
      callback: Parameters<Db['transaction']>[0],
      config?: Parameters<Db['transaction']>[1],
    ): Promise<T> => {
      calls += 1
      const fails = mode === 'exactly' ? calls === n : calls >= n
      if (fails) {
        return Promise.reject(new Error(`transaction ${calls} failed on demand`))
      }
      return db.transaction(callback as never, config) as Promise<T>
    },
  }
  return Object.assign(Object.create(Object.getPrototypeOf(db)), db, failing)
}

export function recordingPushSender(): RecordingPushSender {
  let respond:
    | PushSendResult
    | ((credentials: PushCredentials, payload: PushPayload) => PushSendResult) = 'delivered'
  const sender: RecordingPushSender = {
    sends: [],
    respondWith(result) {
      respond = result
    },
    async send(credentials, payload) {
      sender.sends.push({ credentials, payload })
      return typeof respond === 'function' ? respond(credentials, payload) : respond
    },
  }
  return sender
}

export interface TestHarness {
  db: Db
  clock: FixedClock
  storage: ObjectStorageWithSetup
  jobs: RecordingJobSender
  generateVapidKeys: () => VapidKeys
  /** The test run's container endpoints, for pieces that build their own connections. */
  environment: TestEnvironment
  createSpace(input?: { name?: string; timezone?: string }): Promise<Space>
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
  const jobs = recordingJobSender()
  const deps: AppDeps = {
    db,
    clock,
    storage,
    logger: createSilentLogger(),
    jobs,
    // The production default; an upload-limit test passes its own smaller
    // bound through buildTestApp's overrides.
    mediaMaxUploadBytes: 26_214_400,
    // The real generator: pure CPU, no push service touched, so the
    // persisted test pairs are honest VAPID keys.
    generateVapidKeys,
  }

  return {
    db,
    clock,
    storage,
    jobs,
    generateVapidKeys,
    environment,
    createSpace: (input) =>
      createSpace(
        { db, clock },
        { name: input?.name ?? `Space ${++factoryCounter}`, timezone: input?.timezone },
      ),
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
