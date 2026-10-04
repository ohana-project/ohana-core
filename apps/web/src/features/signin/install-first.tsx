import { useTranslation } from 'react-i18next'
import { Button } from '@/ui/button.tsx'
import { Card, CardContent } from '@/ui/card.tsx'
import { Icon, type IconName } from '@/ui/icon.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs.tsx'

/*
 * The install-first sign-in screen (docs/design/screens/install.html):
 * shown to iOS and iPadOS Safari before any code is asked for (ADR-0005) —
 * the installed app keeps its own cookies and is the only place where Web
 * Push works, so the one-time code is spent there. Continuing in the
 * browser stays one tap away; installation is never forced.
 */

type StepKey = 'ios1' | 'ios2' | 'ios3' | 'android1' | 'android2' | 'android3'

const STEPS: Record<'ios' | 'android', { key: StepKey; icon?: IconName }[]> = {
  ios: [{ key: 'ios1', icon: 'share' }, { key: 'ios2' }, { key: 'ios3' }],
  android: [{ key: 'android1', icon: 'more-h' }, { key: 'android2' }, { key: 'android3' }],
}

function Steps({ platform }: { platform: 'ios' | 'android' }) {
  const { t } = useTranslation()
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {STEPS[platform].map((step, index) => (
        <li
          key={step.key}
          className="flex items-start gap-3 border-b border-border py-2.5 last:border-b-0"
        >
          <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-medium">
            {index + 1}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5 text-sm">
            <span className="font-medium">
              {t(`pwa.install.steps.${step.key}Title`)}
              {step.icon !== undefined && (
                <>
                  {' '}
                  {/* unsized: the icon follows the surrounding text-sm */}
                  <Icon name={step.icon} className="inline-block align-[-2px]" />
                </>
              )}
            </span>
            <span className="text-muted-foreground">{t(`pwa.install.steps.${step.key}Sub`)}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

export function InstallFirst({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation()

  return (
    <div data-slot="install-first" className="flex flex-col gap-4">
      <div className="text-center">
        <h1 className="text-display-lg">{t('pwa.install.title')}</h1>
        <p className="mt-2 text-body text-muted-foreground">{t('pwa.install.subtitle')}</p>
      </div>

      <Card>
        <CardContent>
          {/* The screen only appears on Apple devices; the Android steps
              stay reachable through the tab. */}
          <Tabs defaultValue="ios">
            <TabsList aria-label={t('pwa.install.platformLabel')}>
              <TabsTrigger value="ios">{t('pwa.install.platformIos')}</TabsTrigger>
              <TabsTrigger value="android">{t('pwa.install.platformAndroid')}</TabsTrigger>
            </TabsList>
            <TabsContent value="ios">
              <Steps platform="ios" />
            </TabsContent>
            <TabsContent value="android">
              <Steps platform="android" />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button variant="link" onClick={onContinue}>
          {t('pwa.install.continue')}
        </Button>
      </div>
    </div>
  )
}
