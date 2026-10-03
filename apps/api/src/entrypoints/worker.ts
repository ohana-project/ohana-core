import { buildWorker } from '../app/buildWorker.ts'
import { ensureVapidKeys } from '../modules/notifications/index.ts'
import { systemClock } from '../platform/clock.ts'
import { loadConfigOrExit } from '../platform/config.ts'
import { createDb } from '../platform/db/index.ts'
import { startJobQueue } from '../platform/jobs/pgboss.ts'
import { createLogger } from '../platform/logging.ts'
import { createWebPushSender, generateVapidKeys } from '../platform/push/webpush.ts'
import { storageFromConfig } from '../platform/storage/s3.ts'

async function main(): Promise<void> {
  const config = await loadConfigOrExit()
  if (config === undefined) return

  const logger = createLogger(config)
  const { db, close } = createDb(config.databaseUrl)
  const storage = storageFromConfig(config)
  await storage.ensureBucket()
  // The Web Push identity (issue #22): generated on the installation's
  // first start and persisted, so every subscription the browsers minted
  // against the public key keeps answering this sender's signature.
  const vapid = await ensureVapidKeys({ db, clock: systemClock, generateKeys: generateVapidKeys })
  if (config.pushVapidSubject === 'mailto:ohana@example.com') {
    // Deliverable, not deliverable-to: the placeholder survives, the push
    // services have nobody to reach about abuse. The deployment answers
    // with PUSH_VAPID_SUBJECT.
    logger.warn(
      'PUSH_VAPID_SUBJECT is still the placeholder; set a real mailto: or https:// contact in the deployment configuration.',
    )
  }
  const push = createWebPushSender(vapid, logger, config.pushVapidSubject)
  const boss = await startJobQueue(config.databaseUrl, logger)
  const worker = buildWorker({ db, clock: systemClock, logger, storage, push, boss })
  await worker.start()

  const shutdown = async (): Promise<void> => {
    await worker.stop()
    await close()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main()
