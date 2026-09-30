import { describe, expect, test } from 'vitest'
import { hashPassword, verifyPassword } from './password.ts'

describe('password hashing', () => {
  test('verifies the password it hashed', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true)
  })

  test('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('wrong horse battery staple', stored)).toBe(false)
  })

  test('salts every hash differently', async () => {
    const first = await hashPassword('same password')
    const second = await hashPassword('same password')
    expect(first).not.toBe(second)
    expect(await verifyPassword('same password', second)).toBe(true)
  })

  test('verifies against the cost parameters stored in the hash', async () => {
    // A row written by an installation whose parameters were smaller than
    // today's: the derivation must follow the record, not the constants.
    const { randomBytes, scrypt } = await import('node:crypto')
    const salt = randomBytes(16)
    const derived = await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        'older installation password',
        salt,
        32,
        { N: 16384, r: 8, p: 1, maxmem: 64 * 2 ** 20 },
        (error, key) => (error === null ? resolve(key) : reject(error)),
      )
    })
    const stored = `$scrypt$n=16384,r=8,p=1$${salt.toString('base64')}$${derived.toString('base64')}`
    await expect(verifyPassword('older installation password', stored)).resolves.toBe(true)
    await expect(verifyPassword('a different password', stored)).resolves.toBe(false)
    await expect(verifyPassword('password', '$scrypt$wat=x$abc$def')).resolves.toBe(false)
  })

  test('rejects malformed stored hashes instead of throwing', async () => {
    await expect(verifyPassword('password', '')).resolves.toBe(false)
    await expect(verifyPassword('password', 'plaintext')).resolves.toBe(false)
    await expect(verifyPassword('password', '$argon2id$n=1$x$y')).resolves.toBe(false)
    await expect(
      verifyPassword('password', '$scrypt$n=65536,r=8,p=1$not-base64!$also!'),
    ).resolves.toBe(false)
  })
})
