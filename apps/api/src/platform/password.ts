import {
  type BinaryLike,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'

// OWASP-recommended scrypt parameters (ADR-0005: a slow password hash):
// 128 * N * r = 64 MiB of memory per derivation.
const scryptParameters = { N: 2 ** 16, r: 8, p: 1 } as const
const scryptOptions = { ...scryptParameters, maxmem: 128 * 2 ** 20 }
const keyLength = 32
const saltLength = 16

function derive(password: BinaryLike, salt: BinaryLike, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, scryptOptions, (error, derivedKey) => {
      if (error !== null) reject(error)
      else resolve(derivedKey)
    })
  })
}

function serialize(salt: Buffer, derivedKey: Buffer): string {
  const { N, r, p } = scryptParameters
  return `$scrypt$n=${N},r=${r},p=${p}$${salt.toString('base64')}$${derivedKey.toString('base64')}`
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltLength)
  const derivedKey = await derive(password, salt, keyLength)
  return serialize(salt, derivedKey)
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  const salt = parts[3] !== undefined ? Buffer.from(parts[3], 'base64') : undefined
  const expectedKey = parts[4] !== undefined ? Buffer.from(parts[4], 'base64') : undefined
  if (parts[1] !== 'scrypt' || salt === undefined || expectedKey === undefined) return false
  const derivedKey = await derive(password, salt, expectedKey.length)
  return derivedKey.length === expectedKey.length && timingSafeEqual(derivedKey, expectedKey)
}
