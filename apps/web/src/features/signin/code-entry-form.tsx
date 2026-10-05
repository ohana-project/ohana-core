import { useMutation } from '@tanstack/react-query'
import type * as React from 'react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/data/api.ts'
import { ApiError, assertOk } from '@/data/api-error.ts'
import { useRedeemedSignIn } from '@/features/member/use-member-session.ts'
import { AccessCodeInput } from '@/ui/access-code-input.tsx'
import { Button } from '@/ui/button.tsx'
import { Field, FieldError, FieldLabel } from '@/ui/field.tsx'
import { toast } from '@/ui/toast.tsx'
import { SignInHeader } from './sign-in-header.tsx'

/*
 * The code-entry screen (docs/design/screens/code-entry.html): the
 * centred header (logo, display heading, 32-character lead), one code
 * field that formats while typing, an inline error line, and one
 * primary button. A wrong code marks the field invalid and shakes.
 * Extra affordances — the installation offer — mount between the
 * header and the form.
 */

export type RedeemResult = {
  member: { id: string; name: string; displayName?: string; role: 'owner' | 'regular' }
  space: { id: string; name: string }
  needsOnboarding: boolean
}

type SigninErrorKey =
  | 'signin.errors.access_code_invalid'
  | 'signin.errors.access_code_expired'
  | 'signin.errors.access_code_used'
  | 'signin.errors.access_code_replaced'
  | 'signin.errors.access_code_revoked'
  | 'signin.errors.unexpected'

const signinErrorKeys: Partial<Record<string, SigninErrorKey>> = {
  access_code_invalid: 'signin.errors.access_code_invalid',
  access_code_expired: 'signin.errors.access_code_expired',
  access_code_used: 'signin.errors.access_code_used',
  access_code_replaced: 'signin.errors.access_code_replaced',
  access_code_revoked: 'signin.errors.access_code_revoked',
}

/** Translates a stable API error code into the caller's locale. */
export function signinErrorMessage(
  error: unknown,
  translate: (key: SigninErrorKey) => string,
): string {
  if (error instanceof ApiError) {
    const key = signinErrorKeys[error.code]
    if (key !== undefined) return translate(key)
  }
  return translate('signin.errors.unexpected')
}

export function CodeEntryForm({
  onSignedIn,
  children,
}: {
  onSignedIn: (result: RedeemResult) => void
  children?: React.ReactNode
}) {
  const { t } = useTranslation()
  const rememberSignIn = useRedeemedSignIn()
  const [code, setCode] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [errorText, setErrorText] = useState<string | undefined>(undefined)

  const redeem = useMutation({
    mutationFn: async (typed: string): Promise<RedeemResult> => {
      const response = await api.POST('/api/v1/access-codes/redeem', { body: { code: typed } })
      await assertOk(response)
      if (response.data === undefined) throw new ApiError('unexpected')
      return response.data
    },
    onSuccess: async (result) => {
      // The registry remembers who is signed in; the cookie stays with the
      // browser, which sends it back to the member-named cookie jar.
      await rememberSignIn(result.member, result.space)
      toast(t('signin.successToast'))
      onSignedIn(result)
    },
    onError: (error) => {
      setInvalid(true)
      setErrorText(signinErrorMessage(error, t))
    },
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (redeem.isPending) return
    if (code.length !== 8) {
      setInvalid(true)
      setErrorText(t('signin.emptyCode'))
      return
    }
    // Dropping data-invalid for a render lets the shake animation replay.
    setInvalid(false)
    setErrorText(undefined)
    redeem.mutate(code)
  }

  return (
    <div className="flex flex-col">
      <SignInHeader
        title={t('signin.title')}
        lead={t('signin.description')}
        leadClassName="max-w-[32ch]"
      />
      {children}
      <form onSubmit={submit} className="flex flex-col gap-4.5" noValidate>
        <Field data-invalid={invalid || undefined}>
          <FieldLabel htmlFor="access-code">{t('signin.label')}</FieldLabel>
          <AccessCodeInput
            id="access-code"
            placeholder="XXXX-XXXX"
            invalid={invalid}
            onValueChange={setCode}
            onInvalidClear={() => {
              setInvalid(false)
              setErrorText(undefined)
            }}
          />
          {errorText !== undefined ? (
            <FieldError role="alert">
              <span data-slot="code-error">{errorText}</span>
            </FieldError>
          ) : null}
        </Field>
        <Button type="submit" size="lg" disabled={redeem.isPending}>
          {t('signin.submit')}
        </Button>
      </form>
    </div>
  )
}
