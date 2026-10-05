import type { Locale } from '@ohana/i18n'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
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
import { RadioCard, RadioGroup } from '@/ui/radio-group.tsx'

/*
 * The onboarding screen (docs/design/screens/onboarding.html): the space
 * meta line above the display heading, the display name first, the
 * optional contacts beside each other with a locked hint, and the
 * interface language as two full-width choice cards with a radio. The
 * language comes preselected — the member's stored preference, else the
 * device's locale (the prototype pins «Русский») — and applies to the
 * whole app immediately. Everything is optional (ADR-0005).
 */

const LANGUAGES: Locale[] = ['ru', 'en']

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
  const [language, setLanguage] = useState<Locale>(
    () => me.member.interfaceLanguage ?? (i18n.language === 'en' ? 'en' : 'ru'),
  )
  const [errorText, setErrorText] = useState<string | undefined>(undefined)

  // A stored preference leads the whole interface from arrival, not only
  // the checked card: a member invited with «English» on a Russian device
  // would otherwise read Russian under a checked «English» card, and
  // clicking the already-checked card changes nothing. Each stored value
  // applies once — react-i18next hands back a new wrapper object on every
  // language change, and a bare effect would fight the member's own
  // choice of the other card forever.
  const storedLanguage = me.member.interfaceLanguage
  const appliedStored = useRef<Locale | undefined>(undefined)
  useEffect(() => {
    if (storedLanguage === undefined || appliedStored.current === storedLanguage) return
    appliedStored.current = storedLanguage
    if (storedLanguage === i18n.language) return
    void i18n.changeLanguage(storedLanguage)
    storeLocale(storedLanguage)
  }, [storedLanguage, i18n])

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
          {/* The prototype's hint: a sibling in the 18px stack pulled up
              8px, so 10px stay under the fields. */}
          <p className="mt-2.5 flex items-center gap-1.5 text-meta text-muted-foreground">
            <Icon name="lock" className="size-3.5 shrink-0" />
            {t('onboarding.contactsHint')}
          </p>
        </div>
        <Field>
          <FieldLabel id="onboarding-language-label">{t('onboarding.languageLabel')}</FieldLabel>
          <RadioGroup
            name="interface-language"
            aria-labelledby="onboarding-language-label"
            value={language}
            onValueChange={chooseLanguage}
          >
            {LANGUAGES.map((locale) => (
              <RadioCard key={locale} value={locale} media={<Icon name="globe" />}>
                {t(`language.${locale}`)}
              </RadioCard>
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
