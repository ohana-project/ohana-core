import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthLayout } from '@/ui/auth-layout.tsx'
import { Button } from '@/ui/button.tsx'
import { Icon } from '@/ui/icon.tsx'
import { CodeEntryForm, type RedeemResult } from './code-entry-form.tsx'
import { InstallFirst } from './install-first.tsx'
import { useInstallEnvironment } from './use-install-environment.ts'
import { useInstallPrompt } from './use-install-prompt.ts'

/*
 * The sign-in gate (issue #11, ADR-0005): on iOS and iPadOS Safari outside
 * the installed app, Home Screen installation is offered first and the
 * access code is asked for only after "continue in the browser" — the
 * installed app keeps its own cookies and is the only place where Web Push
 * works, so the one-time code is spent there. Where the browser can install
 * without leaving the page (Chromium platforms), installation is offered
 * above the form but never required.
 */
export function SignInScreen({ onSignedIn }: { onSignedIn: (result: RedeemResult) => void }) {
  const { t } = useTranslation()
  const install = useInstallEnvironment()
  const [continueInBrowser, setContinueInBrowser] = useState(false)
  const { available: canPromptInstall, promptInstall } = useInstallPrompt()

  if (install.installFirst && !continueInBrowser) {
    return (
      <AuthLayout footer={t('pwa.install.footer')}>
        <InstallFirst onContinue={() => setContinueInBrowser(true)} />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout footer={t('signin.footer')}>
      <div className="flex flex-col gap-4">
        {canPromptInstall && (
          <Button variant="secondary" size="lg" onClick={promptInstall}>
            <Icon name="install" />
            {t('pwa.installButton')}
          </Button>
        )}
        <CodeEntryForm onSignedIn={onSignedIn} />
      </div>
    </AuthLayout>
  )
}
