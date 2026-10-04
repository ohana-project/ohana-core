import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { applyAppUpdate, isAppUpdateReady, subscribeToAppUpdate } from '@/lib/app-update.ts'
import { cn } from '@/lib/cn'
import { Banner } from '@/ui/banner.tsx'
import { Button } from '@/ui/button.tsx'

/*
 * The new-version offer (issue #11): presentation for the page-lifetime
 * watcher (lib/app-update.ts). When the service worker has installed the
 * next version and waits, a quiet banner offers a reload; the reload is
 * the member's choice — the current version keeps running until then. The
 * shells mount it in the page flow, so it pushes content down instead of
 * covering anything and scrolls away like any other content.
 */
export function UpdatePrompt({ className }: { className?: string }) {
  const { t } = useTranslation()
  const updateReady = useSyncExternalStore(subscribeToAppUpdate, isAppUpdateReady)

  if (!updateReady) return null

  return (
    <div className={cn('mb-4', className)}>
      <Banner
        icon="sync"
        action={
          <Button variant="link" size="sm" onClick={applyAppUpdate} className="-mx-2">
            {t('pwa.update.action')}
          </Button>
        }
      >
        {t('pwa.update.ready')}
      </Banner>
    </div>
  )
}
