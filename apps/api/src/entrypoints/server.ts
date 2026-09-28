import { buildApp } from '../app/buildApp.ts'
import { systemClock } from '../platform/clock.ts'
import { loadConfigOrExit } from '../platform/config.ts'
import { createDb } from '../platform/db/index.ts'
import { createLogger } from '../platform/logging.ts'
import { storageFromConfig } from '../platform/storage/s3.ts'

async function main(): Promise<void> {
  const config = await loadConfigOrExit()
  if (config === undefined) return

  const logger = createLogger(config)
  const { db, close } = createDb(config.databaseUrl)
  const storage = storageFromConfig(config)
  await storage.ensureBucket()

  const app = buildApp({ db, storage, clock: systemClock, logger })
  await app.listen({ port: config.port, host: '0.0.0.0' })

  const shutdown = async (): Promise<void> => {
    await app.close()
    await close()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main()
