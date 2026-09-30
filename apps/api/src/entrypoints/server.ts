import { buildApp } from '../app/buildApp.ts'
import { ensureInitialAdministrator } from '../modules/admin/index.ts'
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

  // The first instance administrator is provisioned from deployment
  // configuration on first start (ADR-0005); an existing administrator is
  // never overwritten by configuration.
  const bootstrap = await ensureInitialAdministrator(
    { db, clock: systemClock },
    config.adminInitialPassword,
  )
  if (bootstrap === 'unconfigured') {
    logger.error(
      'No instance administrator exists. Set ADMIN_INITIAL_PASSWORD in the deployment configuration and start the server once to create it.',
    )
    process.exitCode = 1
    await close()
    return
  }
  if (bootstrap === 'exists' && config.adminInitialPassword !== undefined) {
    logger.info('The instance administrator already exists; ADMIN_INITIAL_PASSWORD is ignored')
  }

  const app = buildApp({
    db,
    storage,
    clock: systemClock,
    logger,
    webDist: config.webDist,
  })
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
