import type { Readable } from 'node:stream'
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadBucketCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  ListObjectsV2Command,
  NoSuchKey,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type { Config } from '../config.ts'
import {
  ObjectNotFoundError,
  type ObjectStorage,
  type PutOptions,
  StorageError,
  type StoredObject,
} from './index.ts'

export interface S3StorageConfig {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

function isNotFound(error: unknown): boolean {
  if (error instanceof NoSuchKey) return true
  if (typeof error === 'object' && error !== null) {
    const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
    if (metadata?.httpStatusCode === 404) return true
    const name = (error as { name?: string }).name
    if (name === 'NotFound' || name === 'NoSuchBucket') return true
  }
  return false
}

function toStorageError(operation: string, key: string | undefined, error: unknown): StorageError {
  const target = key === undefined ? operation : `${operation} ${key}`
  return new StorageError(`S3 ${target} failed`, { cause: error })
}

export interface ObjectStorageWithSetup extends ObjectStorage {
  ensureBucket(): Promise<void>
}

export function storageFromConfig(
  config: Pick<
    Config,
    'storageEndpoint' | 'storageRegion' | 'storageAccessKey' | 'storageSecretKey' | 'storageBucket'
  >,
): ObjectStorageWithSetup {
  return createS3Storage({
    endpoint: config.storageEndpoint,
    region: config.storageRegion,
    accessKeyId: config.storageAccessKey,
    secretAccessKey: config.storageSecretKey,
    bucket: config.storageBucket,
  })
}

export function createS3Storage(config: S3StorageConfig): ObjectStorageWithSetup {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
  const bucket = config.bucket

  return {
    async put(key: string, body: Readable, options?: PutOptions): Promise<void> {
      try {
        const upload = new Upload({
          client,
          params: { Bucket: bucket, Key: key, Body: body, ContentType: options?.contentType },
        })
        await upload.done()
      } catch (error) {
        throw toStorageError('put', key, error)
      }
    },

    async get(key: string): Promise<Readable> {
      let response: GetObjectCommandOutput
      try {
        response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      } catch (error) {
        if (isNotFound(error)) throw new ObjectNotFoundError(key)
        throw toStorageError('get', key, error)
      }
      return response.Body as Readable
    },

    async head(key: string): Promise<StoredObject | null> {
      let response: HeadObjectCommandOutput
      try {
        response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      } catch (error) {
        if (isNotFound(error)) return null
        throw toStorageError('head', key, error)
      }
      return {
        size: response.ContentLength ?? 0,
        contentType: response.ContentType,
      }
    },

    async delete(key: string): Promise<void> {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
      } catch (error) {
        if (isNotFound(error)) return
        throw toStorageError('delete', key, error)
      }
    },

    async list(prefix: string): Promise<string[]> {
      const keys: string[] = []
      let token: string | undefined
      try {
        do {
          const response = await client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: prefix,
              ContinuationToken: token,
            }),
          )
          for (const object of response.Contents ?? []) {
            if (object.Key !== undefined) keys.push(object.Key)
          }
          token = response.IsTruncated ? response.NextContinuationToken : undefined
        } while (token !== undefined)
      } catch (error) {
        throw toStorageError('list', prefix, error)
      }
      return keys
    },

    async ping(): Promise<void> {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }))
      } catch (error) {
        throw toStorageError('head bucket', bucket, error)
      }
    },

    async ensureBucket(): Promise<void> {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }))
      } catch (error) {
        const name = (error as { name?: string }).name
        if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') return
        throw toStorageError('create bucket', bucket, error)
      }
    },
  }
}
