import {
  type BinaryLike,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'

// The administrative password minimum (ADR-0005). Lives beside the hashing
// capability so the configuration schema and the admin module share it.
export const MIN_ADMIN_PASSWORD_LENGTH = 10

// OWASP-recommended scrypt parameters (ADR-0005: a slow password hash):
// 128 * N * r = 64 MiB of memory per derivation.
const scryptParameters = { N: 2 ** 16, r: 8, p: 1 } as const
const keyLength = 32
const saltLength = 16

// scrypt allocates its memory up front, so unbounded concurrent derivations
// would let a burst of sign-in attempts exhaust the server's memory
// (version 1.0 has no rate limiting, ADR-0005). Derivations are therefore
// serialized: an honest sign-in is rare and only waits, never fails.
let derivationChain: Promise<unknown> = Promise.resolve()

function queueDerivation(task: () => Promise<Buffer>): Promise<Buffer> {
  const result = derivationChain.then(task, task)
  derivationChain = result.catch(() => undefined)
  return result
}

function derive(
  password: BinaryLike,
  salt: BinaryLike,
  length: number,
  cost: { N: number; r: number; p: number },
): Promise<Buffer> {
  // scrypt refuses to run when maxmem is below what 128 * N * r needs.
  const maxmem = 256 * cost.N * cost.r
  return queueDerivation(
    () =>
      new Promise((resolve, reject) => {
        scryptCallback(password, salt, length, { ...cost, maxmem }, (error, derivedKey) => {
          if (error !== null) reject(error)
          else resolve(derivedKey)
        })
      }),
  )
}

function serialize(salt: Buffer, derivedKey: Buffer): string {
  const { N, r, p } = scryptParameters
  return `$scrypt$n=${N},r=${r},p=${p}$${salt.toString('base64')}$${derivedKey.toString('base64')}`
}

function parseCost(segment: string | undefined): { N: number; r: number; p: number } | undefined {
  if (segment === undefined) return undefined
  const values = new Map<string, number>()
  for (const part of segment.split(',')) {
    const [name, value] = part.split('=')
    const parsed = Number(value)
    if (name === undefined || value === undefined || !Number.isInteger(parsed) || parsed <= 0) {
      return undefined
    }
    values.set(name, parsed)
  }
  const { N, r, p } = {
    N: values.get('n'),
    r: values.get('r'),
    p: values.get('p'),
  }
  // scrypt requires a power-of-two N; anything else cannot have been
  // produced by this module and is treated as malformed, not thrown.
  if (N === undefined || r === undefined || p === undefined || (N & (N - 1)) !== 0 || N < 1024) {
    return undefined
  }
  return { N, r, p }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltLength)
  const derivedKey = await derive(password, salt, keyLength, scryptParameters)
  return serialize(salt, derivedKey)
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  const salt = parts[3] !== undefined ? Buffer.from(parts[3], 'base64') : undefined
  const expectedKey = parts[4] !== undefined ? Buffer.from(parts[4], 'base64') : undefined
  const cost = parseCost(parts[2])
  // A key shorter than the ones this module produces (including an empty
  // segment) would make timingSafeEqual compare empty buffers and accept
  // any password.
  if (
    parts[1] !== 'scrypt' ||
    cost === undefined ||
    salt === undefined ||
    expectedKey === undefined ||
    expectedKey.length < keyLength
  ) {
    return false
  }
  try {
    const derivedKey = await derive(password, salt, expectedKey.length, cost)
    return derivedKey.length === expectedKey.length && timingSafeEqual(derivedKey, expectedKey)
  } catch {
    return false
  }
}
