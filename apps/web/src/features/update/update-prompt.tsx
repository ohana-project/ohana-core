import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AppUpdate, watchForAppUpdates } from '@/lib/service-worker-updates.ts'
import { Banner } from '@/ui/banner.tsx'
import { Button } from '@/ui/button.tsx'

/*
 * The new-version offer (issue #11): when the service worker has installed
 * the next version and waits, a quiet banner offers a reload. The reload is
 * the member's choice — the current version keeps running until then.
 */
export function UpdatePrompt() {
  const { t } = useTranslation()
  const [updateReady, setUpdateReady] = useState(false)
  const applyUpdate = useRef<() => void>(() => {})

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    return watchForAppUpdates(navigator.serviceWorker, '/sw.js', (update: AppUpdate) => {
      applyUpdate.current = update.apply
      setUpdateReady(true)
    })
  }, [])

  const reload = useCallback(() => applyUpdate.current(), [])

  if (!updateReady) return null

  return (
    <div className="fixed inset-x-4 bottom-[calc(var(--tabbar-h)+16px)] z-80 desktop:left-auto desktop:right-6 desktop:w-96">
      <Banner
        icon="sync"
        action={
          <Button variant="link" size="sm" onClick={reload} className="-mx-2">
            {t('pwa.update.action')}
          </Button>
        }
      >
        {t('pwa.update.ready')}
      </Banner>
    </div>
  )
}
