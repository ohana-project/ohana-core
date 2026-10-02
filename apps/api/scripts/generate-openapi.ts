import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { buildApp } from '../src/app/buildApp.ts'
import { systemClock } from '../src/platform/clock.ts'
import { createDb } from '../src/platform/db/index.ts'
import type { JobSender } from '../src/platform/jobs/index.ts'
import { createSilentLogger } from '../src/platform/logging.ts'
import { createS3Storage } from '../src/platform/storage/s3.ts'

const openApiPath = fileURLToPath(new URL('../openapi.json', import.meta.url))

const { db, close } = createDb('postgresql://127.0.0.1:5432/openapi-generation')
const storage = createS3Storage({
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  accessKeyId: 'unused',
  secretAccessKey: 'unused',
  bucket: 'unused',
})

// The document comes from the route schemas; no request runs, so no queue
// is needed behind the jobs port.
const jobs: JobSender = { sendInTx: async () => {} }

const app = buildApp({
  db,
  storage,
  clock: systemClock,
  logger: createSilentLogger(),
  jobs,
  mediaMaxUploadBytes: 26_214_400,
})
await app.ready()
const document = `${JSON.stringify(app.swagger(), null, 2)}\n`
await close()

if (process.argv.includes('--check')) {
  const committed = await readFile(openApiPath, 'utf8')
  if (committed !== document) {
    console.error(
      'openapi.json differs from the route schemas. Run "pnpm --filter @ohana/api openapi:generate" and commit the result.',
    )
    process.exitCode = 1
  } else {
    console.log('openapi.json is up to date')
  }
} else {
  await writeFile(openApiPath, document)
  console.log('Wrote openapi.json')
}
