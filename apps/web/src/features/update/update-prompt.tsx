import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AppUpdate, watchForAppUpdates } from '@/lib/service-worker-updates.ts'
import { Banner } from '@/ui/banner.tsx'
import { Button } from '@/ui/button.tsx'

/*
 * The new-version offer (issue #11): when the service worker has installed
 * the next version and waits, a quiet banner offers a reload. The reload is
 * the member's choice — the current version keeps running until then, so
 * the banner never blocks a control: it hangs below the top bar, clear of
 * the toast viewport at the bottom edge.
 */
export function UpdatePrompt() {
  const { t } = useTranslation()
  const [updateReady, setUpdateReady] = useState(false)
  const applyUpdate = useRef<() => void>(() => {})

  useEffect(() => {
    // There is no service worker outside the built app: the dev server's
    // /sw.js is a 404, and vitest runs under its own mode. MODE is
    // 'production' exactly for build output, so the registration keys on it.
    if (import.meta.env.MODE !== 'production' || !('serviceWorker' in navigator)) return
    return watchForAppUpdates(navigator.serviceWorker, '/sw.js', (update: AppUpdate) => {
      applyUpdate.current = update.apply
      setUpdateReady(true)
    })
  }, [])

  const reload = useCallback(() => applyUpdate.current(), [])

  if (!updateReady) return null

  return (
    // Hanging below the 56px top bar (min-h-14): the sticky bar keeps its
    // controls reachable, the toasts keep the bottom edge, and the banner
    // stays a quiet offer instead of a modal intrusion.
    <div className="fixed inset-x-4 top-16 z-30 desktop:left-auto desktop:right-6 desktop:w-96">
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
