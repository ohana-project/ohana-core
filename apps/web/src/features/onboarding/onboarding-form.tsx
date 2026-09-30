import type { Locale } from '@ohana/i18n'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/data/api.ts'
import { ApiError, assertOk } from '@/data/api-error.ts'
import { renameSession } from '@/data/session-registry.ts'
import type { MemberMe } from '@/features/member/use-member-session.ts'
import { storeLocale } from '@/lib/locale-storage.ts'
import { Button } from '@/ui/button.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/field.tsx'
import { Input } from '@/ui/input.tsx'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group.tsx'

/*
 * The onboarding screen (docs/design/screens/onboarding.html): the display
 * name first, the optional contacts beside each other, and the interface
 * language as two choice cards. Everything is optional (ADR-0005), the
 * language applies to the whole app immediately.
 */

export type OnboardingErrorKey = 'member.errors.validation_failed' | 'member.errors.unexpected'

/** Translates a stable API error code into the caller's locale. */
export function onboardingErrorMessage(
  error: unknown,
  translate: (key: OnboardingErrorKey) => string,
): string {
  if (error instanceof ApiError && error.code === 'validation_failed') {
    return translate('member.errors.validation_failed')
  }
  return translate('member.errors.unexpected')
}

export function OnboardingForm({ me, onCompleted }: { me: MemberMe; onCompleted: () => void }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [language, setLanguage] = useState<Locale | ''>('')
  const [errorText, setErrorText] = useState<string | undefined>(undefined)

  const complete = useMutation({
    mutationFn: async () => {
      const response = await api.POST('/api/v1/me/onboarding', {
        body: {
          displayName: displayName.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          interfaceLanguage: language === '' ? undefined : language,
        },
      })
      await assertOk(response)
    },
    onSuccess: async () => {
      renameSession(me.member.id, displayName.trim() || undefined)
      // The session probe carries the member's profile; the next screen
      // must greet the member by their new name, not the pre-onboarding one.
      await queryClient.invalidateQueries({ queryKey: ['member', 'session'] })
      onCompleted()
    },
    onError: (error) => setErrorText(onboardingErrorMessage(error, t)),
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (complete.isPending) return
    setErrorText(undefined)
    complete.mutate()
  }

  const chooseLanguage = (value: string[]) => {
    const next = value.at(-1)
    if (next !== 'ru' && next !== 'en') return
    setLanguage(next)
    // The chosen language is the member's interface preference; the whole
    // app switches with it, and it rides to the server with the form.
    void i18n.changeLanguage(next)
    storeLocale(next)
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-display-lg">{t('onboarding.title')}</h1>
      <p className="text-body text-muted-foreground">{t('onboarding.description')}</p>
      <form onSubmit={submit} className="mt-2 flex flex-col gap-3.5" noValidate>
        <Field>
          <FieldLabel htmlFor="onboarding-display-name">
            {t('onboarding.displayNameLabel')}
          </FieldLabel>
          <Input
            id="onboarding-display-name"
            value={displayName}
            maxLength={200}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <FieldDescription>{t('onboarding.displayNameHint')}</FieldDescription>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="onboarding-email">{t('onboarding.emailLabel')}</FieldLabel>
            <Input
              id="onboarding-email"
              type="email"
              value={email}
              maxLength={200}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="onboarding-phone">{t('onboarding.phoneLabel')}</FieldLabel>
            <Input
              id="onboarding-phone"
              type="tel"
              value={phone}
              maxLength={40}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel>{t('onboarding.languageLabel')}</FieldLabel>
          <ToggleGroup value={language === '' ? [] : [language]} onValueChange={chooseLanguage}>
            <ToggleGroupItem value="ru">{t('language.ru')}</ToggleGroupItem>
            <ToggleGroupItem value="en">{t('language.en')}</ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription>{t('onboarding.languageHint')}</FieldDescription>
        </Field>
        {errorText !== undefined ? (
          <FieldError role="alert">
            <span data-slot="onboarding-error">{errorText}</span>
          </FieldError>
        ) : null}
        <Button type="submit" size="lg" disabled={complete.isPending}>
          {t('onboarding.submit')}
        </Button>
      </form>
    </div>
  )
}
