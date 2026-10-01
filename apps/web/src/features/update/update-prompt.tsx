import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AppUpdate, watchForAppUpdates } from '@/lib/service-worker-updates.ts'
import { Banner } from '@/ui/banner.tsx'
import { Button } from '@/ui/button.tsx'

/*
 * The new-version offer (issue #11): when the service worker has installed
 * the next version and waits, a quiet banner offers a reload. The reload is
 * the member's choice — the current version keeps running until then. The
 * banner is part of the page flow at the top of each shell, so it pushes
 * content down instead of covering anything and scrolls away like any
 * other content. Each shell mounts it once; a route renders exactly one
 * shell, so the worker is registered exactly once per page.
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
    <div className="mb-4">
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
