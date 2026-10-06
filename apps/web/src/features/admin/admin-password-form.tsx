import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { adminErrorMessage, useAdminChangePassword } from '@/features/admin/use-admin-session.ts'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/field.tsx'
import { Input } from '@/ui/input.tsx'
import { SectionHeader } from '@/ui/section-header.tsx'
import { toast } from '@/ui/toast.tsx'

interface PasswordFieldErrors {
  currentPassword?: string
  newPassword?: string
  repeatedPassword?: string
}

/*
 * The administrator password form (docs/design/screens/admin-settings.html,
 * "Пароль администратора"): the prototype's padded card, the three fields
 * 14px apart, and the submit row 18px below them — the screen's one
 * primary button with its hint beside it. The minimum-length and match
 * rules are checked before the API is called.
 */
export function AdminPasswordForm() {
  const { t } = useTranslation()
  const changePassword = useAdminChangePassword()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeatedPassword, setRepeatedPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<PasswordFieldErrors>({})

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (changePassword.isPending) return
    const failures: PasswordFieldErrors = {}
    if (currentPassword.length === 0) failures.currentPassword = t('admin.password.currentRequired')
    if (newPassword.length < 10) failures.newPassword = t('admin.password.newError')
    if (repeatedPassword.length === 0 || repeatedPassword !== newPassword) {
      failures.repeatedPassword = t('admin.password.repeatError')
    }
    setFieldErrors(failures)
    if (
      failures.currentPassword !== undefined ||
      failures.newPassword !== undefined ||
      failures.repeatedPassword !== undefined
    ) {
      return
    }
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword('')
          setNewPassword('')
          setRepeatedPassword('')
          toast(t('admin.password.success'))
        },
        onError: (error) => {
          setFieldErrors({ currentPassword: adminErrorMessage(error, t) })
        },
      },
    )
  }

  return (
    <section>
      <SectionHeader level={3} title={t('admin.password.title')} />
      <Card variant="padded">
        <form onSubmit={submit} noValidate>
          {/* The prototype's field stack: the three fields 14px apart, the
              submit row outside it, 18px below (admin-settings.html). */}
          <div className="flex flex-col gap-3.5">
            <Field data-invalid={fieldErrors.currentPassword !== undefined || undefined}>
              <FieldLabel htmlFor="admin-current-password">
                {t('admin.password.currentLabel')}
              </FieldLabel>
              <Input
                id="admin-current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => {
                  setCurrentPassword(event.target.value)
                  setFieldErrors((previous) => ({ ...previous, currentPassword: undefined }))
                }}
              />
              {fieldErrors.currentPassword !== undefined ? (
                <FieldError>{fieldErrors.currentPassword}</FieldError>
              ) : null}
            </Field>
            <Field data-invalid={fieldErrors.newPassword !== undefined || undefined}>
              <FieldLabel htmlFor="admin-new-password">{t('admin.password.newLabel')}</FieldLabel>
              <Input
                id="admin-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value)
                  setFieldErrors((previous) => ({ ...previous, newPassword: undefined }))
                }}
              />
              {fieldErrors.newPassword !== undefined ? (
                <FieldError>{fieldErrors.newPassword}</FieldError>
              ) : (
                <FieldDescription>{t('admin.password.newHint')}</FieldDescription>
              )}
            </Field>
            <Field data-invalid={fieldErrors.repeatedPassword !== undefined || undefined}>
              <FieldLabel htmlFor="admin-repeat-password">
                {t('admin.password.repeatLabel')}
              </FieldLabel>
              <Input
                id="admin-repeat-password"
                type="password"
                autoComplete="new-password"
                value={repeatedPassword}
                onChange={(event) => {
                  setRepeatedPassword(event.target.value)
                  setFieldErrors((previous) => ({ ...previous, repeatedPassword: undefined }))
                }}
              />
              {fieldErrors.repeatedPassword !== undefined ? (
                <FieldError>{fieldErrors.repeatedPassword}</FieldError>
              ) : null}
            </Field>
          </div>
          <div className="mt-4.5 flex flex-wrap items-center gap-2.5">
            <Button type="submit" disabled={changePassword.isPending}>
              {t('admin.password.submit')}
            </Button>
            <span className="text-meta text-muted-foreground">{t('admin.password.note')}</span>
          </div>
        </form>
      </Card>
    </section>
  )
}
