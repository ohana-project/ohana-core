import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { adminErrorMessage, useAdminSignIn } from '@/features/admin/use-admin-session.ts'
import { Badge } from '@/ui/badge.tsx'
import { Button } from '@/ui/button.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/field.tsx'
import { Input } from '@/ui/input.tsx'
import { Logo } from '@/ui/logo.tsx'

/*
 * The administrative sign-in screen (docs/design/screens/admin-login.html):
 * the brand row — lockup and «АДМИНКА» pill —, the display heading at
 * the prototype's 6px/22px rhythm, one password field, and the
 * console-recovery note. Wrong passwords mark the field invalid and
 * shake.
 */
export function AdminLoginForm({ onSignedIn }: { onSignedIn?: () => void }) {
  const { t } = useTranslation()
  const signIn = useAdminSignIn()
  const [password, setPassword] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [errorText, setErrorText] = useState<string | undefined>(undefined)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (signIn.isPending) return
    setErrorText(undefined)
    // Dropping data-invalid for a render lets the shake animation replay.
    setInvalid(false)
    signIn.mutate(password, {
      onSuccess: () => onSignedIn?.(),
      onError: (error) => {
        setInvalid(true)
        setErrorText(adminErrorMessage(error, t))
      },
    })
  }

  return (
    <div>
      {/* The prototype's `admin-login-brand` row: the lockup and the
          «АДМИНКА» pill on one row, 26px above the title. */}
      <div className="mb-[26px] flex items-center gap-3">
        <Logo />
        <Badge variant="neutral">{t('admin.pill')}</Badge>
      </div>
      <h1 className="mb-1.5 text-display-lg">{t('admin.login.title')}</h1>
      <p className="mb-[22px] text-body text-muted-foreground">{t('admin.login.description')}</p>
      <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
        <Field data-invalid={invalid || undefined}>
          <FieldLabel htmlFor="admin-password">{t('admin.login.passwordLabel')}</FieldLabel>
          <Input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setInvalid(false)
              setErrorText(undefined)
            }}
          />
          {errorText !== undefined ? <FieldError>{errorText}</FieldError> : null}
          <FieldDescription>{t('admin.login.passwordHint')}</FieldDescription>
        </Field>
        <Button type="submit" size="lg" disabled={signIn.isPending}>
          {t('admin.login.submit')}
        </Button>
      </form>
    </div>
  )
}
