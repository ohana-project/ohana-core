import { buildApp } from '../app/buildApp.ts'
import { ensureInitialAdministrator } from '../modules/admin/index.ts'
import { systemClock } from '../platform/clock.ts'
import { loadConfigOrExit } from '../platform/config.ts'
import { createDb } from '../platform/db/index.ts'
import { createPgBossJobSender, startJobQueue } from '../platform/jobs/pgboss.ts'
import { createLogger } from '../platform/logging.ts'
import { storageFromConfig } from '../platform/storage/s3.ts'

async function main(): Promise<void> {
  const config = await loadConfigOrExit()
  if (config === undefined) return

  const logger = createLogger(config)
  const { db, close } = createDb(config.databaseUrl)
  const storage = storageFromConfig(config)
  await storage.ensureBucket()

  // The API's own pg-boss instance (ADR-0009): the domain transactions send
  // their jobs through it; the worker process claims and runs them.
  const boss = await startJobQueue(config.databaseUrl)
  const jobs = createPgBossJobSender(boss)

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

  const app = buildApp({
    db,
    storage,
    clock: systemClock,
    logger,
    jobs,
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
