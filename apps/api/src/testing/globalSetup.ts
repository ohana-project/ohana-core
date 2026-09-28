import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { GenericContainer } from 'testcontainers'
import { createDb } from '../platform/db/index.ts'
import { runMigrations } from '../platform/db/migrate.ts'
import { createS3Storage } from '../platform/storage/s3.ts'

const POSTGRES_IMAGE = 'postgres:18-alpine'
const RUSTFS_IMAGE = 'rustfs/rustfs:1.0.0'
const STORAGE_ACCESS_KEY = 'ohana-test'
const STORAGE_SECRET_KEY = 'ohana-test-secret'
const STORAGE_BUCKET = 'ohana-test'

async function waitForStorage(endpoint: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/health`)
      if (response.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`RustFS at ${endpoint} did not become healthy in time`)
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const [postgres, rustfs] = await Promise.all([
    new PostgreSqlContainer(POSTGRES_IMAGE).start(),
    new GenericContainer(RUSTFS_IMAGE)
      .withEnvironment({
        RUSTFS_ACCESS_KEY: STORAGE_ACCESS_KEY,
        RUSTFS_SECRET_KEY: STORAGE_SECRET_KEY,
      })
      .withExposedPorts(9000)
      .start(),
  ])
  const storageEndpoint = `http://${rustfs.getHost()}:${rustfs.getMappedPort(9000)}`

  const { db, close } = createDb(postgres.getConnectionUri())
  try {
    await runMigrations(db)
  } finally {
    await close()
  }

  const storage = createS3Storage({
    endpoint: storageEndpoint,
    region: 'us-east-1',
    accessKeyId: STORAGE_ACCESS_KEY,
    secretAccessKey: STORAGE_SECRET_KEY,
    bucket: STORAGE_BUCKET,
  })
  await storage.ensureBucket()
  await waitForStorage(storageEndpoint)

  process.env.OHANA_TEST_DATABASE_URL = postgres.getConnectionUri()
  process.env.OHANA_TEST_STORAGE_ENDPOINT = storageEndpoint
  process.env.OHANA_TEST_STORAGE_ACCESS_KEY = STORAGE_ACCESS_KEY
  process.env.OHANA_TEST_STORAGE_SECRET_KEY = STORAGE_SECRET_KEY
  process.env.OHANA_TEST_STORAGE_BUCKET = STORAGE_BUCKET

  return async () => {
    await Promise.all([postgres.stop(), rustfs.stop()])
  }
}
