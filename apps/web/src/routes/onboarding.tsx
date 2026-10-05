import { createFileRoute } from '@tanstack/react-router'
import { OnboardingScreen } from '@/features/onboarding/onboarding-screen.tsx'

/*
 * The onboarding route (docs/design/screens/onboarding.html): step two of
 * the sign-in flow. The screen owns the probe, the draft, and the layout;
 * the route only mounts it.
 */
export const Route = createFileRoute('/onboarding')({
  component: OnboardingScreen,
})
