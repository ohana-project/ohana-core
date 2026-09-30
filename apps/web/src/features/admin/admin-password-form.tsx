import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { adminErrorMessage, useAdminChangePassword } from '@/features/admin/use-admin-session.ts'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/field.tsx'
import { Input } from '@/ui/input.tsx'
import { toast } from '@/ui/toast.tsx'

interface PasswordFields {
  current?: string
  next?: string
  repeat?: string
}

/*
 * The administrator password form (docs/design/screens/admin-settings.html,
 * "Пароль администратора"): current, new, and repeat fields with the
 * minimum-length and match rules checked before the API is called.
 */
export function AdminPasswordForm() {
  const { t } = useTranslation()
  const changePassword = useAdminChangePassword()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [problems, setProblems] = useState<PasswordFields>({})

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (changePassword.isPending) return
    const found: PasswordFields = {}
    if (current.length === 0) found.current = t('admin.password.currentRequired')
    if (next.length < 10) found.next = t('admin.password.newError')
    if (repeat.length === 0 || repeat !== next) found.repeat = t('admin.password.repeatError')
    setProblems(found)
    if (found.current !== undefined || found.next !== undefined || found.repeat !== undefined) {
      return
    }
    changePassword.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          setCurrent('')
          setNext('')
          setRepeat('')
          toast(t('admin.password.success'))
        },
        onError: (error) => {
          setProblems({ current: adminErrorMessage(error, t) })
        },
      },
    )
  }

  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="px-1">{t('admin.password.title')}</h3>
      <Card>
        <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
          <Field data-invalid={problems.current !== undefined || undefined}>
            <FieldLabel htmlFor="admin-current-password">
              {t('admin.password.currentLabel')}
            </FieldLabel>
            <Input
              id="admin-current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => {
                setCurrent(event.target.value)
                setProblems((previous) => ({ ...previous, current: undefined }))
              }}
            />
            {problems.current !== undefined ? <FieldError>{problems.current}</FieldError> : null}
          </Field>
          <Field data-invalid={problems.next !== undefined || undefined}>
            <FieldLabel htmlFor="admin-new-password">{t('admin.password.newLabel')}</FieldLabel>
            <Input
              id="admin-new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => {
                setNext(event.target.value)
                setProblems((previous) => ({ ...previous, next: undefined }))
              }}
            />
            {problems.next !== undefined ? (
              <FieldError>{problems.next}</FieldError>
            ) : (
              <FieldDescription>{t('admin.password.newHint')}</FieldDescription>
            )}
          </Field>
          <Field data-invalid={problems.repeat !== undefined || undefined}>
            <FieldLabel htmlFor="admin-repeat-password">
              {t('admin.password.repeatLabel')}
            </FieldLabel>
            <Input
              id="admin-repeat-password"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => {
                setRepeat(event.target.value)
                setProblems((previous) => ({ ...previous, repeat: undefined }))
              }}
            />
            {problems.repeat !== undefined ? <FieldError>{problems.repeat}</FieldError> : null}
          </Field>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
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
