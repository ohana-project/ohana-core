import { useTranslation } from 'react-i18next'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Icon, type IconName } from '@/ui/icon.tsx'
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs.tsx'
import { SignInHeader } from './sign-in-header.tsx'

/*
 * The install-first sign-in screen (docs/design/screens/install.html):
 * shown to iOS and iPadOS Safari before any code is asked for (ADR-0005) —
 * the installed app keeps its own cookies and is the only place where Web
 * Push works, so the one-time code is spent there. Continuing in the
 * browser stays one tap away; installation is never forced. The centred
 * header (logo, display heading, 34-character lead) sits above the steps
 * card: the platform switch with the browsers' meta line beside it, then
 * 52px step rows with mono muted numbers.
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
        <Item key={step.key} size="sm" render={<li />} className="px-1">
          {/* The prototype's `.leading.num` is the shared media's `num`
              variant: a 28px mono muted number on a round plate. */}
          <ItemMedia variant="num">{index + 1}</ItemMedia>
          <ItemContent>
            <ItemTitle>{t(`pwa.install.steps.${step.key}Title`)}</ItemTitle>
            <ItemDescription>
              {t(`pwa.install.steps.${step.key}Sub`)}
              {step.icon !== undefined && (
                <>
                  {' '}
                  {/* unsized: the icon follows the surrounding text-sm */}
                  <Icon name={step.icon} className="inline-block align-[-2px]" />
                </>
              )}
            </ItemDescription>
          </ItemContent>
        </Item>
      ))}
    </ol>
  )
}

export function InstallFirst({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation()

  return (
    <div data-slot="install-first" className="flex flex-col">
      <SignInHeader
        title={t('pwa.install.title')}
        lead={t('pwa.install.subtitle')}
        leadClassName="max-w-[34ch]"
        className="mb-6.5"
      />

      <Card variant="padded">
        <Tabs defaultValue="ios" className="gap-0">
          <div className="mb-4 flex items-center justify-between gap-3">
            <TabsList aria-label={t('pwa.install.platformLabel')}>
              <TabsTrigger value="ios">{t('pwa.install.platformIos')}</TabsTrigger>
              <TabsTrigger value="android">{t('pwa.install.platformAndroid')}</TabsTrigger>
            </TabsList>
            <span className="font-mono text-meta text-muted-foreground">
              {t('pwa.install.browsers')}
            </span>
          </div>
          {/* The screen only appears on Apple devices; the Android steps
              stay reachable through the tab. */}
          <TabsContent value="ios">
            <Steps platform="ios" />
          </TabsContent>
          <TabsContent value="android">
            <Steps platform="android" />
          </TabsContent>
        </Tabs>
      </Card>

      <div className="mt-3.5 flex justify-center">
        <Button variant="link" onClick={onContinue}>
          {t('pwa.install.continue')}
        </Button>
      </div>
    </div>
  )
}
