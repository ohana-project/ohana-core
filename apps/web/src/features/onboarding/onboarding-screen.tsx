import { deviceLocale } from '@ohana/i18n'
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
 * refetches, and everything the member typed or chosen survives that swap.
 * The draft is keyed to the member it was seeded from, so a member switch
 * (another sign-in, the accounts screen) reseeds it empty — no member
 * reads or submits another's entries. The seed leads with the member's
 * stored preference, else the device's locale, and the arrival applies
 * that preference to the whole interface once per arrival; after it the
 * member's own choice on the cards is the latest word, riding the device
 * locale the rest of the app reads.
 */

/** The draft together with the member it was seeded from. */
type OwnedDraft = { memberId: string; draft: OnboardingDraft }

export function OnboardingScreen() {
  const { t, i18n } = useTranslation()
  const session = useMemberSessionStatus()
  const navigate = useNavigate()

  const [owned, setOwned] = useState<OwnedDraft | undefined>(undefined)
  const me = session.me
  if (me !== undefined && (owned === undefined || owned.memberId !== me.member.id)) {
    setOwned({
      memberId: me.member.id,
      draft: {
        displayName: '',
        email: '',
        phone: '',
        language: me.member.interfaceLanguage ?? deviceLocale(),
        storedApplied: false,
      },
    })
  }

  const storedLanguage = me?.member.interfaceLanguage
  useEffect(() => {
    if (owned === undefined || owned.draft.storedApplied) return
    // The stored preference leads the interface on arrival; absent one,
    // the device's locale does — Russian when the device speaks neither
    // supported language.
    const preference = storedLanguage ?? deviceLocale()
    if (preference !== i18n.language) {
      void i18n.changeLanguage(preference)
      storeLocale(preference)
    }
    setOwned({
      memberId: owned.memberId,
      draft: { ...owned.draft, language: preference, storedApplied: true },
    })
  }, [owned, storedLanguage, i18n])

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
          me={me}
          draft={owned?.draft}
          onDraftChange={(next) =>
            setOwned((prev) =>
              prev === undefined ? undefined : { memberId: prev.memberId, draft: next },
            )
          }
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
