import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AuthLayout } from '@/app/layouts/auth-layout.tsx'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'
import { type MemberMe, useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { OnboardingForm } from '@/features/onboarding/onboarding-form.tsx'

/*
 * The onboarding screen (docs/design/screens/onboarding.html): step two of
 * the sign-in flow, right after the code is accepted. A member that has
 * already onboarded goes straight home.
 */
function OnboardingPage() {
  const { t } = useTranslation()
  const session = useMemberSessionStatus()

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
        <OnboardingInner me={session.me} />
      </MemberSessionGate>
    </AuthLayout>
  )
}

function OnboardingInner({ me }: { me: MemberMe | undefined }) {
  const navigate = useNavigate()
  if (me === undefined) return null
  if (!me.needsOnboarding) return <Navigate to="/" replace />
  return <OnboardingForm me={me} onCompleted={() => void navigate({ to: '/' })} />
}

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
})
