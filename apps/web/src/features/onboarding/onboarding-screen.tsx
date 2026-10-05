import { Navigate, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthLayout } from '@/app/layouts/auth-layout.tsx'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'
import { type MemberMe, useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { storeLocale } from '@/lib/locale-storage.ts'
import { type OnboardingDraft, OnboardingForm } from './onboarding-form.tsx'

/*
 * The onboarding screen (docs/design/screens/onboarding.html): step two of
 * the sign-in flow, right after the code is accepted; a member that has
 * already onboarded goes straight home. The draft lives here, above the
 * session gate: the gate swaps its children for a spinner while the probe
 * refetches, and everything the member typed or chose survives that swap.
 * The draft seeds once, from the probe's first answer — a member's stored
 * preference leads the interface on arrival (once per arrival; a fresh
 * arrival follows it again), and after that their own choice on the cards
 * is the latest word, riding the device locale the rest of the app reads.
 */
export function OnboardingScreen() {
  const { t, i18n } = useTranslation()
  const session = useMemberSessionStatus()
  const navigate = useNavigate()

  const [draft, setDraft] = useState<OnboardingDraft | undefined>(undefined)
  if (draft === undefined && session.me !== undefined) {
    setDraft({
      displayName: '',
      email: '',
      phone: '',
      language: session.me.member.interfaceLanguage ?? (i18n.language === 'en' ? 'en' : 'ru'),
      storedApplied: false,
    })
  }

  const storedLanguage = session.me?.member.interfaceLanguage
  useEffect(() => {
    if (draft === undefined || draft.storedApplied) return
    if (storedLanguage === undefined) {
      setDraft({ ...draft, storedApplied: true })
      return
    }
    if (storedLanguage !== i18n.language) {
      void i18n.changeLanguage(storedLanguage)
      storeLocale(storedLanguage)
    }
    setDraft({ ...draft, language: storedLanguage, storedApplied: true })
  }, [draft, storedLanguage, i18n])

  return (
    <AuthLayout
      columnWidth={460}
      // The onboarding prototype has no logo: the space meta line leads.
      logo={false}
      footer={
        session.me === undefined
          ? undefined
          : t('onboarding.footer', { space: session.me.space.name })
      }
    >
      <MemberSessionGate require="signed-in" redirectTo="/signin">
        <OnboardingInner
          me={session.me}
          draft={draft}
          onDraftChange={setDraft}
          onCompleted={() => void navigate({ to: '/' })}
        />
      </MemberSessionGate>
    </AuthLayout>
  )
}

function OnboardingInner({
  me,
  draft,
  onDraftChange,
  onCompleted,
}: {
  me: MemberMe | undefined
  draft: OnboardingDraft | undefined
  onDraftChange: (draft: OnboardingDraft) => void
  onCompleted: () => void
}) {
  if (me === undefined || draft === undefined) return null
  if (!me.needsOnboarding) return <Navigate to="/" replace />
  return (
    <OnboardingForm me={me} draft={draft} onDraftChange={onDraftChange} onCompleted={onCompleted} />
  )
}
