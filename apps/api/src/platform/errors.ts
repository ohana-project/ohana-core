export class DomainError extends Error {
  readonly code: string
  readonly httpStatus: number

  constructor(code: string, message: string, httpStatus = 400) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

export function notFound(code: string, message: string): DomainError {
  return new DomainError(code, message, 404)
}
