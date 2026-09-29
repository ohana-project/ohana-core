import { randomFillSync, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { describe, expect, test } from 'vitest'
import { readTestEnvironment } from '../../testing/harness.ts'
import { ObjectNotFoundError } from './index.ts'
import { createS3Storage } from './s3.ts'

const environment = readTestEnvironment()
const storage = createS3Storage({
  endpoint: environment.storageEndpoint,
  region: 'us-east-1',
  accessKeyId: environment.storageAccessKey,
  secretAccessKey: environment.storageSecretKey,
  bucket: environment.storageBucket,
})

function testKey(variant: string): string {
  return `spaces/${randomUUID()}/media/${randomUUID()}/${variant}`
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function randomBytes(size: number): Buffer {
  const buffer = Buffer.alloc(size)
  for (let offset = 0; offset < buffer.length; offset += 65536) {
    randomFillSync(buffer, offset, Math.min(65536, buffer.length - offset))
  }
  return buffer
}

function chunkBuffer(buffer: Buffer, size: number): Buffer[] {
  const chunks: Buffer[] = []
  for (let offset = 0; offset < buffer.length; offset += size) {
    chunks.push(buffer.subarray(offset, offset + size))
  }
  return chunks
}

describe('S3 storage adapter against RustFS', () => {
  test('put and get round-trip a stream', async () => {
    const key = testKey('original')
    await storage.put(key, Readable.from(['hello ', 'world']), { contentType: 'text/plain' })

    const body = await storage.get(key)
    const contents = await collect(body)
    expect(contents.toString('utf8')).toBe('hello world')
  })

  test('head returns size and content type, or null for missing objects', async () => {
    const key = testKey('original')
    await storage.put(key, Readable.from([Buffer.alloc(32)]), { contentType: 'image/png' })

    const stored = await storage.head(key)
    expect(stored).toEqual({ size: 32, contentType: 'image/png' })

    const missing = await storage.head(`${key}-missing`)
    expect(missing).toBeNull()
  })

  test('streaming upload switches to multipart for payloads larger than one part', async () => {
    const key = testKey('original')
    // 12 MiB with the 5 MiB default part size produces three parts, so the
    // CreateMultipartUpload/UploadPart/CompleteMultipartUpload path runs.
    const payload = randomBytes(12 * 1024 * 1024)
    await storage.put(key, Readable.from(chunkBuffer(payload, 1024 * 1024)))

    const body = await storage.get(key)
    const contents = await collect(body)
    expect(contents.length).toBe(payload.length)
    expect(contents.equals(payload)).toBe(true)
  })

  test('delete removes the object and tolerates repeated deletes', async () => {
    const key = testKey('original')
    await storage.put(key, Readable.from(['bye']))

    await storage.delete(key)
    expect(await storage.head(key)).toBeNull()

    await storage.delete(key)

    await expect(storage.get(key)).rejects.toThrow(ObjectNotFoundError)
  })

  test('list returns keys under a prefix', async () => {
    const prefix = `spaces/${randomUUID()}/media/list-case`
    await storage.put(`${prefix}/a/original`, Readable.from(['a']))
    await storage.put(`${prefix}/b/original`, Readable.from(['b']))
    await storage.put(`${prefix}/b/derivative`, Readable.from(['c']))

    const keys = await storage.list(`${prefix}/`)
    expect(keys.sort()).toEqual([
      `${prefix}/a/original`,
      `${prefix}/b/derivative`,
      `${prefix}/b/original`,
    ])
  })
})
