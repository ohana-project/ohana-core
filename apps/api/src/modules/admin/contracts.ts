import { Type } from '@sinclair/typebox'
import { MIN_ADMIN_PASSWORD_LENGTH } from './service.ts'

export const SignInBodySchema = Type.Object(
  {
    password: Type.String({ minLength: 1, maxLength: 1024 }),
  },
  { additionalProperties: false },
)

/**
 * Declared (optional, so the guard can answer 403 itself) so the OpenAPI
 * document names the marker header that state-changing administrative
 * requests must carry.
 */
export const AdminMarkerHeadersSchema = Type.Object({
  'x-ohana-admin': Type.Optional(Type.String({ minLength: 1 })),
})

export const ChangePasswordBodySchema = Type.Object(
  {
    currentPassword: Type.String({ minLength: MIN_ADMIN_PASSWORD_LENGTH, maxLength: 1024 }),
    newPassword: Type.String({ minLength: MIN_ADMIN_PASSWORD_LENGTH, maxLength: 1024 }),
  },
  { additionalProperties: false },
)
