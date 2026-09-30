import { MIN_ADMIN_PASSWORD_LENGTH, resetAdminPassword } from '../modules/admin/index.ts'
import { systemClock } from '../platform/clock.ts'
import { loadConfigOrExit } from '../platform/config.ts'
import { createDb } from '../platform/db/index.ts'
import { createLogger } from '../platform/logging.ts'

function readPasswordArgument(): string | undefined {
  const index = process.argv.indexOf('--password')
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
  const config = await loadConfigOrExit()
  if (config === undefined) return

  const password = readPasswordArgument()
  if (password === undefined) {
    console.error(
      `Usage: node src/entrypoints/reset-admin-password.ts --password <new password>\n` +
        `The new password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters long.`,
    )
    process.exitCode = 1
    return
  }

  const logger = createLogger(config)
  const { db, close } = createDb(config.databaseUrl)
  try {
    await resetAdminPassword({ db, clock: systemClock }, password)
    logger.info(
      'The administrative password has been reset; existing administrative sessions were revoked',
    )
  } catch (error) {
    logger.error({ err: error }, 'Resetting the administrative password failed')
    process.exitCode = 1
  } finally {
    await close()
  }
}

main()
