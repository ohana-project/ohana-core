import { buildWorker } from '../app/buildWorker.ts'
import { systemClock } from '../platform/clock.ts'
import { loadConfigOrExit } from '../platform/config.ts'
import { createDb } from '../platform/db/index.ts'
import { startJobQueue } from '../platform/jobs/pgboss.ts'
import { createLogger } from '../platform/logging.ts'
import { storageFromConfig } from '../platform/storage/s3.ts'

async function main(): Promise<void> {
  const config = await loadConfigOrExit()
  if (config === undefined) return

  const logger = createLogger(config)
  const { db, close } = createDb(config.databaseUrl)
  const storage = storageFromConfig(config)
  await storage.ensureBucket()
  const boss = await startJobQueue(config.databaseUrl, logger)
  const worker = buildWorker({ db, clock: systemClock, logger, storage, boss })
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
