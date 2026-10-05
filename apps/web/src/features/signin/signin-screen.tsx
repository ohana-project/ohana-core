import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthLayout } from '@/app/layouts/auth-layout.tsx'
import { listStoredSessions } from '@/data/session-registry.ts'
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
 *
 * The screens carry no logo of their own — each renders the centred lockup
 * its prototype puts inside the header — and a device that already retains
 * a sign-in can go back to the accounts screen (code-entry.html's leading
 * ghost button).
 */
export function SignInScreen({ onSignedIn }: { onSignedIn: (result: RedeemResult) => void }) {
  const { t } = useTranslation()
  const install = useInstallEnvironment()
  const [continueInBrowser, setContinueInBrowser] = useState(false)
  const { available: canPromptInstall, promptInstall } = useInstallPrompt()
  // The registry is device state; a sign-in added or removed elsewhere
  // remounts this screen, so one read per mount follows it.
  const hasSignIn = listStoredSessions().length > 0

  if (install.installFirst && !continueInBrowser) {
    return (
      <AuthLayout footer={t('pwa.install.footer')} logo={false}>
        <InstallFirst onContinue={() => setContinueInBrowser(true)} />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout footer={t('signin.footer')} logo={false}>
      {hasSignIn && (
        <Button variant="ghost" render={<Link to="/accounts" />} className="-ml-5 mb-5 self-start">
          <Icon name="chevron-left" />
          {t('layout.back')}
        </Button>
      )}
      <CodeEntryForm onSignedIn={onSignedIn}>
        {canPromptInstall && (
          <Button variant="secondary" size="lg" onClick={promptInstall} className="mb-4">
            <Icon name="install" />
            {t('pwa.installButton')}
          </Button>
        )}
      </CodeEntryForm>
    </AuthLayout>
  )
}
