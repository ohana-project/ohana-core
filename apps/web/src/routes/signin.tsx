import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CodeEntryForm } from '@/features/signin/code-entry-form.tsx'
import { AuthLayout } from '@/ui/auth-layout.tsx'

/*
 * The member sign-in screen (docs/design/screens/code-entry.html): the
 * access code is the only credential. The screen stays reachable for a
 * member who is already signed in — a device keeps several independent
 * sign-ins, and entering another code adds one more (ADR-0005).
 */
function SignInPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <AuthLayout footer={t('signin.footer')}>
      <CodeEntryForm
        onSignedIn={(result) => void navigate({ to: result.needsOnboarding ? '/onboarding' : '/' })}
      />
    </AuthLayout>
  )
}

export const Route = createFileRoute('/signin')({
  component: SignInPage,
})
