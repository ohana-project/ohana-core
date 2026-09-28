import pino from 'pino'
import type { Config } from './config.ts'

export type Logger = pino.Logger

const redactedPaths = ['req.headers.cookie', 'req.headers.authorization']

export function createLogger(config: Pick<Config, 'logLevel'>): Logger {
  return pino({
    level: config.logLevel,
    redact: { paths: redactedPaths, censor: '[redacted]' },
  })
}

export function createSilentLogger(): Logger {
  return pino({ level: 'silent' })
}
