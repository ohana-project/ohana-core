import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SignInScreen } from '@/features/signin/signin-screen.tsx'

/*
 * The member sign-in route (docs/design/screens/code-entry.html and
 * install.html): the access code is the only credential, and on iOS and
 * iPadOS Safari the install-first screen comes before it (ADR-0005). The
 * screen stays reachable for a member who is already signed in — a device
 * keeps several independent sign-ins, and entering another code adds one
 * more (issue #9).
 */
function SignInPage() {
  const navigate = useNavigate()

  return (
    <SignInScreen
      onSignedIn={(result) => void navigate({ to: result.needsOnboarding ? '/onboarding' : '/' })}
    />
  )
}

export const Route = createFileRoute('/signin')({
  component: SignInPage,
})
