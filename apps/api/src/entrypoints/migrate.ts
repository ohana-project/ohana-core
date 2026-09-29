import { loadMigrationConfigOrExit } from '../platform/config.ts'
import { createDb } from '../platform/db/index.ts'
import { runMigrations } from '../platform/db/migrate.ts'
import { createLogger } from '../platform/logging.ts'

async function main(): Promise<void> {
  const config = await loadMigrationConfigOrExit()
  if (config === undefined) return

  const logger = createLogger(config)
  const { db, close } = createDb(config.databaseUrl)
  try {
    await runMigrations(db)
    logger.info('Database migrations applied')
  } catch (error) {
    logger.error({ err: error }, 'Database migration failed')
    process.exitCode = 1
  } finally {
    await close()
  }
}

main()
