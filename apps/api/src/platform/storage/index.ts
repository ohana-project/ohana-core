import type { Readable } from 'node:stream'

export interface StoredObject {
  size: number
  contentType?: string
}

export interface PutOptions {
  contentType?: string
}

export interface ObjectStorage {
  put(key: string, body: Readable, options?: PutOptions): Promise<void>
  get(key: string): Promise<Readable>
  head(key: string): Promise<StoredObject | null>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
  ping(): Promise<void>
}

export class ObjectNotFoundError extends Error {
  readonly key: string

  constructor(key: string) {
    super(`Object not found: ${key}`)
    this.name = 'ObjectNotFoundError'
    this.key = key
  }
}

export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StorageError'
  }
}
