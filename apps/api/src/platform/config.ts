import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { type Static, Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const ConfigSchema = Type.Object({
  nodeEnv: Type.Union(
    [Type.Literal('development'), Type.Literal('test'), Type.Literal('production')],
    {
      default: 'development',
    },
  ),
  port: Type.Number({ default: 3000, minimum: 1, maximum: 65535 }),
  logLevel: Type.Union(
    [
      Type.Literal('fatal'),
      Type.Literal('error'),
      Type.Literal('warn'),
      Type.Literal('info'),
      Type.Literal('debug'),
      Type.Literal('trace'),
    ],
    { default: 'info' },
  ),
  databaseUrl: Type.String({ minLength: 1 }),
  storageEndpoint: Type.String({ minLength: 1 }),
  storageRegion: Type.String({ minLength: 1, default: 'us-east-1' }),
  storageAccessKey: Type.String({ minLength: 1 }),
  storageSecretKey: Type.String({ minLength: 1 }),
  storageBucket: Type.String({ minLength: 1 }),
})

export type Config = Static<typeof ConfigSchema>

export class ConfigError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

const environmentNames: Readonly<Record<keyof Config, string>> = {
  nodeEnv: 'NODE_ENV',
  port: 'PORT',
  logLevel: 'LOG_LEVEL',
  databaseUrl: 'DATABASE_URL',
  storageEndpoint: 'STORAGE_ENDPOINT',
  storageRegion: 'STORAGE_REGION',
  storageAccessKey: 'STORAGE_ACCESS_KEY',
  storageSecretKey: 'STORAGE_SECRET_KEY',
  storageBucket: 'STORAGE_BUCKET',
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

export async function loadConfig(environment: NodeJS.ProcessEnv = process.env): Promise<Config> {
  const fileValues = await readDotEnv(fileURLToPath(new URL('../../../../.env', import.meta.url)))
  const raw: Record<string, unknown> = {}
  for (const [key, environmentName] of Object.entries(environmentNames)) {
    const value = environment[environmentName] ?? fileValues[environmentName]
    if (value !== undefined) raw[key] = value
  }
  const prepared = Value.Clean(
    ConfigSchema,
    Value.Default(ConfigSchema, Value.Convert(ConfigSchema, raw)),
  )
  if (!Value.Check(ConfigSchema, prepared)) {
    const issues = [...Value.Errors(ConfigSchema, prepared)].map(
      (error) => `${error.path.slice(1) || '(root)'}: ${error.message}`,
    )
    throw new ConfigError(issues)
  }
  return prepared as Config
}

export async function loadConfigOrExit(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<Config | undefined> {
  try {
    return await loadConfig(environment)
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message)
      process.exitCode = 1
      return undefined
    }
    throw error
  }
}
