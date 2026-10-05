import type { Locale } from '@ohana/i18n'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
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
 * The onboarding form (docs/design/screens/onboarding.html): the space
 * meta line above the display heading, the display name first, the
 * optional contacts beside each other with a locked hint, and the
 * interface language as two full-width choice cards with a radio. The
 * form renders the draft its screen owns — the screen seeds it from the
 * member's stored preference, else the device's locale (the prototype
 * pins «Русский»), and a card's choice applies to the whole app at once.
 * Everything is optional (ADR-0005).
 */

const LANGUAGES: Locale[] = ['ru', 'en']

/** What the member has typed and chosen so far, owned by the screen. */
export type OnboardingDraft = {
  displayName: string
  email: string
  phone: string
  language: Locale
  /** The stored preference has led the interface once; the member's own
   * choice is the latest word after it. */
  storedApplied: boolean
}

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

export function OnboardingForm({
  me,
  draft,
  onDraftChange,
  onCompleted,
}: {
  me: MemberMe
  draft: OnboardingDraft
  onDraftChange: (draft: OnboardingDraft) => void
  onCompleted: () => void
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [errorText, setErrorText] = useState<string | undefined>(undefined)

  const complete = useMutation({
    mutationFn: async () => {
      const response = await api.POST('/api/v1/me/onboarding', {
        body: {
          displayName: draft.displayName.trim() || undefined,
          email: draft.email.trim() || undefined,
          phone: draft.phone.trim() || undefined,
          interfaceLanguage: draft.language,
        },
      })
      await assertOk(response)
    },
    onSuccess: async () => {
      renameSession(me.member.id, draft.displayName.trim() || undefined)
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
    onDraftChange({ ...draft, language: next })
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
            value={draft.displayName}
            maxLength={200}
            onChange={(event) => onDraftChange({ ...draft, displayName: event.target.value })}
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
                value={draft.email}
                maxLength={200}
                onChange={(event) => onDraftChange({ ...draft, email: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="onboarding-phone">{t('onboarding.phoneLabel')}</FieldLabel>
              <Input
                id="onboarding-phone"
                type="tel"
                placeholder={t('onboarding.phonePlaceholder')}
                value={draft.phone}
                maxLength={40}
                onChange={(event) => onDraftChange({ ...draft, phone: event.target.value })}
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
            value={draft.language}
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
