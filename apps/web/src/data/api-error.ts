/*
 * The shared API error body shape ({ error: { code, message } }) and its
 * translation into thrown errors. Every feature mutation uses this instead
 * of hand-rolling error extraction.
 */

export class ApiError extends Error {
  readonly code: string

  constructor(code: string) {
    super(`The API rejected the request with ${code}`)
    this.name = 'ApiError'
    this.code = code
  }
}

export function extractErrorCode(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const code = (body as { error?: { code?: unknown } }).error?.code
    if (typeof code === 'string') return code
  }
  return 'unexpected'
}

export async function assertOk(response: { error?: unknown }): Promise<void> {
  if (response.error !== undefined) throw new ApiError(extractErrorCode(response.error))
}
