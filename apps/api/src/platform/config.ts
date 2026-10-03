import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { type Static, type TSchema, Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { MIN_ADMIN_PASSWORD_LENGTH } from './password.ts'

const nodeEnv = Type.Union(
  [Type.Literal('development'), Type.Literal('test'), Type.Literal('production')],
  { default: 'development' },
)
const logLevel = Type.Union(
  [
    Type.Literal('fatal'),
    Type.Literal('error'),
    Type.Literal('warn'),
    Type.Literal('info'),
    Type.Literal('debug'),
    Type.Literal('trace'),
  ],
  { default: 'info' },
)
/** The placeholder contact the push services see until the operator sets
 *  a real one; the worker warns when an installation still runs with it. */
export const DEFAULT_PUSH_VAPID_SUBJECT = 'mailto:ohana@example.com'

const databaseUrl = Type.String({ minLength: 1 })

const ConfigSchema = Type.Object({
  nodeEnv,
  port: Type.Number({ default: 3000, minimum: 1, maximum: 65535 }),
  logLevel,
  databaseUrl,
  storageEndpoint: Type.String({ minLength: 1 }),
  storageRegion: Type.String({ minLength: 1, default: 'us-east-1' }),
  storageAccessKey: Type.String({ minLength: 1 }),
  storageSecretKey: Type.String({ minLength: 1 }),
  storageBucket: Type.String({ minLength: 1 }),
  // The upload size limit for journal entry photos (issue #17): an upload
  // larger than this answers 413 before anything reaches storage. The
  // original is kept byte-for-byte (ADR-0008), so the limit bounds what one
  // phone photo costs in storage and memory.
  mediaMaxUploadBytes: Type.Integer({ default: 26_214_400, minimum: 1024, maximum: 262_144_000 }),
  // The contact address the Web Push identity carries (issue #22): the
  // push services use it to reach the operator about abuse. A real one
  // keeps an installation deliverable; the default is a placeholder.
  pushVapidSubject: Type.String({
    default: DEFAULT_PUSH_VAPID_SUBJECT,
    pattern: '^(mailto:[^\\s@]+@[^\\s@]+|https://[^\\s/]+)',
  }),
  webDist: Type.Optional(Type.String({ minLength: 1 })),
  // The initial instance-administrator password (ADR-0005): used once to
  // provision the first administrator on first start. An administrator that
  // already exists is never overwritten by this value.
  adminInitialPassword: Type.Optional(Type.String({ minLength: MIN_ADMIN_PASSWORD_LENGTH })),
})

const MigrationConfigSchema = Type.Object({ nodeEnv, logLevel, databaseUrl })

export type Config = Static<typeof ConfigSchema>
export type MigrationConfig = Static<typeof MigrationConfigSchema>

export class ConfigError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

const configEnvironmentNames: Readonly<Record<string, string>> = {
  nodeEnv: 'NODE_ENV',
  port: 'PORT',
  logLevel: 'LOG_LEVEL',
  databaseUrl: 'DATABASE_URL',
  storageEndpoint: 'STORAGE_ENDPOINT',
  storageRegion: 'STORAGE_REGION',
  storageAccessKey: 'STORAGE_ACCESS_KEY',
  storageSecretKey: 'STORAGE_SECRET_KEY',
  storageBucket: 'STORAGE_BUCKET',
  mediaMaxUploadBytes: 'MEDIA_MAX_UPLOAD_BYTES',
  pushVapidSubject: 'PUSH_VAPID_SUBJECT',
  webDist: 'WEB_DIST',
  adminInitialPassword: 'ADMIN_INITIAL_PASSWORD',
}

const migrationEnvironmentNames: Readonly<Record<string, string>> = {
  nodeEnv: 'NODE_ENV',
  logLevel: 'LOG_LEVEL',
  databaseUrl: 'DATABASE_URL',
}

async function readDotEnv(path: string): Promise<Record<string, string>> {
  let contents: string
  try {
    contents = await readFile(path, 'utf8')
  } catch {
    return {}
  }
  const values: Record<string, string> = {}
  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    values[key] = value.replace(/^["']|["']$/g, '')
  }
  return values
}

async function parseConfig(
  schema: TSchema,
  environmentNames: Readonly<Record<string, string>>,
  environment: NodeJS.ProcessEnv,
): Promise<unknown> {
  const fileValues = await readDotEnv(fileURLToPath(new URL('../../../../.env', import.meta.url)))
  const raw: Record<string, unknown> = {}
  for (const [key, environmentName] of Object.entries(environmentNames)) {
    const value = environment[environmentName] ?? fileValues[environmentName]
    // Compose substitutes ${VAR:-} as an empty string for unset variables;
    // an empty value means "not configured", not "invalid".
    if (value !== undefined && value !== '') raw[key] = value
  }
  const prepared = Value.Clean(schema, Value.Default(schema, Value.Convert(schema, raw)))
  if (!Value.Check(schema, prepared)) {
    const issues = [...Value.Errors(schema, prepared)].map(
      (error) => `${error.path.slice(1) || '(root)'}: ${error.message}`,
    )
    throw new ConfigError(issues)
  }
  return prepared
}

export async function loadConfig(environment: NodeJS.ProcessEnv = process.env): Promise<Config> {
  return parseConfig(ConfigSchema, configEnvironmentNames, environment) as Promise<Config>
}

export async function loadMigrationConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<MigrationConfig> {
  return parseConfig(
    MigrationConfigSchema,
    migrationEnvironmentNames,
    environment,
  ) as Promise<MigrationConfig>
}

async function loadOrExit<T>(load: () => Promise<T>): Promise<T | undefined> {
  try {
    return await load()
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message)
      process.exitCode = 1
      return undefined
    }
    throw error
  }
}

export function loadConfigOrExit(): Promise<Config | undefined> {
  return loadOrExit(loadConfig)
}

export function loadMigrationConfigOrExit(): Promise<MigrationConfig | undefined> {
  return loadOrExit(loadMigrationConfig)
}
