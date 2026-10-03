import { buildApp } from '../app/buildApp.ts'
import { ensureInitialAdministrator } from '../modules/admin/index.ts'
import { CALENDAR_SENT_QUEUE_SETUPS } from '../modules/calendar/index.ts'
import { JOURNAL_SENT_QUEUES } from '../modules/journal/index.ts'
import { MEDIA_QUEUE_SETUPS } from '../modules/media/index.ts'
import { ensureVapidKeys } from '../modules/notifications/index.ts'
import { systemClock } from '../platform/clock.ts'
import { loadConfigOrExit } from '../platform/config.ts'
import { createDb } from '../platform/db/index.ts'
import type { QueueSetup } from '../platform/jobs/index.ts'
import { startSendingJobQueue } from '../platform/jobs/pgboss.ts'
import { createLogger } from '../platform/logging.ts'
import { generateVapidKeys } from '../platform/push/webpush.ts'
import { storageFromConfig } from '../platform/storage/s3.ts'

/** Every queue the api's own use cases send to, across the sending
 *  modules — the media queues with the retries their contracts name, the
 *  reminder queue with its own. */
const SENT_QUEUES: QueueSetup[] = [
  ...JOURNAL_SENT_QUEUES.map((name) => ({ name })),
  ...MEDIA_QUEUE_SETUPS,
  ...CALENDAR_SENT_QUEUE_SETUPS,
]

async function main(): Promise<void> {
  const config = await loadConfigOrExit()
  if (config === undefined) return

  const logger = createLogger(config)
  const { db, close } = createDb(config.databaseUrl)
  const storage = storageFromConfig(config)
  await storage.ensureBucket()

  // The API's own pg-boss instance (ADR-0009): the domain transactions send
  // their jobs through it; the worker process claims and runs them. The
  // queues are ensured here too — a fresh installation must not depend on
  // the worker having started before the api's first trash.
  const { boss, sender: jobs } = await startSendingJobQueue(config.databaseUrl, logger, SENT_QUEUES)

  // The first instance administrator is provisioned from deployment
  // configuration on first start (ADR-0005); an existing administrator is
  // never overwritten by configuration.
  const bootstrap = await ensureInitialAdministrator(
    { db, clock: systemClock },
    config.adminInitialPassword,
  )
  if (bootstrap === 'unconfigured') {
    // Served anyway: the installation is inert rather than broken, and the
    // operator fixes it without editing a failing deployment.
    logger.warn(
      'No instance administrator exists yet. Set ADMIN_INITIAL_PASSWORD in the deployment configuration and restart the server once to create it; until then administrative sign-in is rejected.',
    )
  }
  if (bootstrap === 'exists' && config.adminInitialPassword !== undefined) {
    logger.info('The instance administrator already exists; ADMIN_INITIAL_PASSWORD is ignored')
  }

  // The Web Push identity (issue #22): generated on the installation's
  // first start and persisted, so the public key a device signs up against
  // is the one this installation keeps answering with — the worker reads
  // the same row to sign what it sends.
  await ensureVapidKeys({ db, clock: systemClock, generateKeys: generateVapidKeys })

  const app = buildApp({
    db,
    storage,
    clock: systemClock,
    logger,
    jobs,
    mediaMaxUploadBytes: config.mediaMaxUploadBytes,
    generateVapidKeys,
    webDist: config.webDist,
  })
  await app.listen({ port: config.port, host: '0.0.0.0' })

  const shutdown = async (): Promise<void> => {
    await app.close()
    await boss.stop()
    await close()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main()
