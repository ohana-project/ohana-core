import { Type } from '@sinclair/typebox'
import { MIN_ADMIN_PASSWORD_LENGTH } from '../../platform/password.ts'

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
    // The current password carries no minimum: a mistyped short password must
    // answer invalid_credentials, not a shape complaint about a new password.
    currentPassword: Type.String({ minLength: 1, maxLength: 1024 }),
    newPassword: Type.String({ minLength: MIN_ADMIN_PASSWORD_LENGTH, maxLength: 1024 }),
  },
  { additionalProperties: false },
)
