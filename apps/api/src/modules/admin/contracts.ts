import { type Static, Type } from '@sinclair/typebox'
import { MIN_ADMIN_PASSWORD_LENGTH } from '../../platform/password.ts'

/** The bounds the trash retention accepts (ADR-0007); the table's check mirrors them. */
export const MIN_TRASH_RETENTION_DAYS = 1
export const MAX_TRASH_RETENTION_DAYS = 365

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

/** The installation's settings as the administrative area reads them. */
export const AdminSettingsDtoSchema = Type.Object(
  { trashRetentionDays: Type.Integer() },
  { additionalProperties: false },
)

export type AdminSettingsDto = Static<typeof AdminSettingsDtoSchema>

/**
 * The settings patch: only named fields change, and the bounds match the
 * database's own check, so an out-of-range value is a validation answer,
 * never a constraint failure.
 */
export const UpdateSettingsBodySchema = Type.Object(
  {
    trashRetentionDays: Type.Integer({
      minimum: MIN_TRASH_RETENTION_DAYS,
      maximum: MAX_TRASH_RETENTION_DAYS,
    }),
  },
  { additionalProperties: false },
)
