import type { Locale } from '@ohana/i18n'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/data/api.ts'
import { ApiError, assertOk } from '@/data/api-error.ts'
import { renameSession } from '@/data/session-registry.ts'
import { triggerSync } from '@/data/sync-engine.ts'
import { type MemberMe, memberSessionQueryKey } from '@/features/member/use-member-session.ts'
import { storeLocale } from '@/lib/locale-storage.ts'
import { Button } from '@/ui/button.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/field.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Input } from '@/ui/input.tsx'
import { Radio, RadioGroup } from '@/ui/radio-group.tsx'

/*
 * The onboarding screen (docs/design/screens/onboarding.html): the space
 * meta line above the display heading, the display name first, the
 * optional contacts beside each other with a locked hint, and the
 * interface language as two full-width choice cards with a radio. The
 * language is preselected (the prototype checks «Русский»; the form
 * follows the device's current locale) and applies to the whole app
 * immediately. Everything is optional (ADR-0005).
 */

const LANGUAGES: Locale[] = ['ru', 'en']

/*
 * The prototype's choice card: `label.card.card-link` — 56px tall, 10px
 * gap, the 18px radio, a muted globe and the 15px semibold name.
 */
const languageCardClass =
  'flex min-h-14 flex-1 cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3.5 text-body shadow-1 transition-[box-shadow,transform,border-color] duration-(--t-base) ease-(--ease) select-none hover:-translate-y-px hover:border-[color-mix(in_oklch,var(--fg)_16%,var(--border))] hover:shadow-2'

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
  const [language, setLanguage] = useState<Locale>(() => (i18n.language === 'en' ? 'en' : 'ru'))
  const [errorText, setErrorText] = useState<string | undefined>(undefined)

  const complete = useMutation({
    mutationFn: async () => {
      const response = await api.POST('/api/v1/me/onboarding', {
        body: {
          displayName: displayName.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          interfaceLanguage: language,
        },
      })
      await assertOk(response)
    },
    onSuccess: async () => {
      renameSession(me.member.id, displayName.trim() || undefined)
      // The stored profile is refreshed through the sync, not patched by
      // hand (issue #14).
      void triggerSync(me.member.id)
      // The session probe carries the member's profile; the next screen
      // must greet the member by their new name, not the pre-onboarding one.
      await queryClient.invalidateQueries({ queryKey: memberSessionQueryKey })
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

  const chooseLanguage = (next: Locale) => {
    setLanguage(next)
    // The chosen language is the member's interface preference; the whole
    // app switches with it, and it rides to the server with the form.
    void i18n.changeLanguage(next)
    storeLocale(next)
  }

  return (
    <div className="flex flex-col">
      <div className="mb-6">
        <p className="mb-2 font-mono text-meta text-muted-foreground uppercase">
          {t('onboarding.meta', { space: me.space.name })}
        </p>
        <h1 className="mb-2 text-display">{t('onboarding.title')}</h1>
        <p className="text-body text-muted-foreground">{t('onboarding.description')}</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4.5" noValidate>
        <Field>
          <FieldLabel htmlFor="onboarding-display-name">
            {t('onboarding.displayNameLabel')}
          </FieldLabel>
          <Input
            id="onboarding-display-name"
            placeholder={t('onboarding.displayNamePlaceholder')}
            value={displayName}
            maxLength={200}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
        <div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field>
              <FieldLabel htmlFor="onboarding-email">{t('onboarding.emailLabel')}</FieldLabel>
              <Input
                id="onboarding-email"
                type="email"
                placeholder={t('onboarding.emailPlaceholder')}
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
                placeholder={t('onboarding.phonePlaceholder')}
                value={phone}
                maxLength={40}
                onChange={(event) => setPhone(event.target.value)}
              />
            </Field>
          </div>
          <p className="-mt-2 flex items-center gap-1.5 text-meta text-muted-foreground">
            <Icon name="lock" className="size-3.5 shrink-0" />
            {t('onboarding.contactsHint')}
          </p>
        </div>
        <Field>
          <FieldLabel>{t('onboarding.languageLabel')}</FieldLabel>
          <RadioGroup
            name="interface-language"
            aria-label={t('onboarding.languageLabel')}
            value={language}
            onValueChange={chooseLanguage}
          >
            {LANGUAGES.map((locale) => (
              <Fragment key={locale}>
                {/* biome-ignore lint/a11y/noLabelWithoutControl: the Base UI
                    radio inside renders the native input this label controls */}
                <label className={languageCardClass}>
                  <Radio value={locale} />
                  <Icon name="globe" className="size-[18px] text-muted-foreground" />
                  <span className="text-[15px] leading-snug font-semibold">
                    {t(`language.${locale}`)}
                  </span>
                </label>
              </Fragment>
            ))}
          </RadioGroup>
          <FieldDescription>{t('onboarding.languageHint')}</FieldDescription>
        </Field>
        {errorText !== undefined ? (
          <FieldError role="alert">
            <span data-slot="onboarding-error">{errorText}</span>
          </FieldError>
        ) : null}
        {/* The prototype's submit rides 6px below the stack's 18px gap. */}
        <Button type="submit" size="lg" disabled={complete.isPending} className="mt-1.5">
          {t('onboarding.submit')}
        </Button>
      </form>
    </div>
  )
}
