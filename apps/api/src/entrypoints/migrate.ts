import { loadConfigOrExit } from '../platform/config.ts'
import { createDb } from '../platform/db/index.ts'
import { runMigrations } from '../platform/db/migrate.ts'
import { createLogger } from '../platform/logging.ts'

async function main(): Promise<void> {
  const config = await loadConfigOrExit()
  if (config === undefined) return

  const logger = createLogger(config)
  const { db, close } = createDb(config.databaseUrl)
  try {
    await runMigrations(db)
    logger.info('Database migrations applied')
  } finally {
    await close()
  }
}

main()
