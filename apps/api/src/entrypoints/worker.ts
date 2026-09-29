import { buildWorker } from '../app/buildWorker.ts'
import { loadConfigOrExit } from '../platform/config.ts'
import { createDb } from '../platform/db/index.ts'
import { createLogger } from '../platform/logging.ts'

async function main(): Promise<void> {
  const config = await loadConfigOrExit()
  if (config === undefined) return

  const logger = createLogger(config)
  const { db, close } = createDb(config.databaseUrl)
  const worker = buildWorker({ db, logger })
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
