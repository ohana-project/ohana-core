import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { SettingsShell } from '@/features/space-settings/settings-shell.tsx'
import { Badge } from '@/ui/badge.tsx'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/ui/item.tsx'
import { SectionHeader } from '@/ui/section-header.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { Switch } from '@/ui/switch.tsx'
import { toast } from '@/ui/toast.tsx'
import type { NotificationContainer, PushRegistrar } from './push-client.ts'
import {
  pushErrorMessage,
  useBrowserSubscription,
  useDisablePush,
  useEnablePush,
  useMySubscription,
  useSetNotifyDetails,
} from './use-push-subscription.ts'

/*
 * The notifications screen (issue #22): this device's push subscription
 * and its own opt-in to event details. The enable action is the user
 * gesture the browser requires — the permission prompt only opens from a
 * real activation. The iOS note is part of the ticket: reminders need the
 * installed app there, and the screen says so before anyone wonders where
 * the prompt went.
 */

/** The browser's Notification, or nothing on a platform without one. */
function notificationContainer(): NotificationContainer | undefined {
  return typeof window.Notification === 'undefined' ? undefined : window.Notification
}

/** The registration's push manager, once the worker is ready; the page
 *  runs only where the worker registered, so this settles in a moment. */
function usePushRegistrar(): PushRegistrar | undefined {
  const [registrar, setRegistrar] = useState<PushRegistrar | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    void navigator.serviceWorker?.ready.then((registration) => {
      if (!cancelled) setRegistrar(registration.pushManager)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return registrar
}

const isIos =
  // The platform note: iPadOS 13+ reports as Mac, hence the touch probe.
  /iP(hone|od|ad)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function NotificationsScreen() {
  const { t } = useTranslation()
  const registrar = usePushRegistrar()
  const notification = notificationContainer()

  const browser = useBrowserSubscription(registrar)
  const memberId = getActiveMemberId()
  const mine = useMySubscription(memberId, browser.subscription, browser.refresh)
  const enable = useEnablePush(notification ?? rejectedNotification, registrar ?? emptyRegistrar)
  const disable = useDisablePush()
  const setDetails = useSetNotifyDetails()

  // The switches read the member's own row, never the browser's object:
  // another member of this device may hold the physical subscription.
  // Absent (the 404) and not-yet-read both mean off.
  const subscribed = mine.isSuccess && mine.data !== null
  const permission = notification?.permission ?? 'denied'
  const notifyDetails = mine.data?.notifyDetails ?? false
  const busy = enable.isPending || disable.isPending || setDetails.isPending || mine.isFetching

  const toggleSubscription = (next: boolean) => {
    console.log('TOGGLE-DBG', next, memberId)
    if (next) {
      if (memberId === undefined) return
      enable.mutate(
        { memberId, notifyDetails },
        {
          onSuccess: () => {
            toast(t('notifications.settings.enabledToast'))
            void mine.refresh()
          },
          onError: (error) => {
            toast(
              pushErrorMessage(error) === 'denied'
                ? t('notifications.settings.deniedToast')
                : t('notifications.settings.enableFailedToast'),
              'danger',
            )
          },
        },
      )
      return
    }
    const browserSubscription = browser.subscription
    if (browserSubscription === null || memberId === undefined) return
    disable.mutate(
      { memberId, subscription: browserSubscription },
      {
        onSuccess: () => {
          toast(t('notifications.settings.disabledToast'))
          void mine.refresh()
        },
        onError: () => toast(t('notifications.settings.disableFailedToast'), 'danger'),
      },
    )
  }

  const toggleDetails = (next: boolean) => {
    const endpoint = browser.subscription?.endpoint
    if (endpoint === undefined || memberId === undefined) return
    setDetails.mutate(
      { memberId, endpoint, notifyDetails: next },
      {
        onSuccess: () => {
          toast(t('notifications.settings.detailsSavedToast'))
          void mine.refresh()
        },
        onError: () => toast(t('notifications.settings.detailsFailedToast'), 'danger'),
      },
    )
  }

  return (
    <SettingsShell title={t('notifications.settings.title')}>
      <div className="flex flex-col gap-6 pt-6">
        <header>
          <h1 className="text-display-lg">{t('notifications.settings.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('notifications.settings.subtitle')}
          </p>
        </header>

        {isIos ? (
          <Card className="flex flex-col gap-1">
            <p className="text-sm font-medium">{t('notifications.settings.iosTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('notifications.settings.iosText')}</p>
          </Card>
        ) : null}

        <section>
          <SectionHeader title={t('notifications.settings.deviceSection')} />
          <Card className="py-0">
            <ItemGroup>
              <Item size="lg">
                <ItemMedia variant="icon" tone="primary">
                  <Switch
                    checked={subscribed}
                    onCheckedChange={toggleSubscription}
                    disabled={
                      registrar === undefined ||
                      notification === undefined ||
                      busy ||
                      !browser.settled
                    }
                    aria-label={t('notifications.settings.enableSwitch')}
                  />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    <span className="inline-flex items-center gap-2">
                      {t('notifications.settings.deviceTitle')}
                      {busy ? <Spinner className="size-4" /> : null}
                    </span>
                  </ItemTitle>
                  <ItemDescription>
                    {subscribed
                      ? t('notifications.settings.deviceOn')
                      : permission === 'denied'
                        ? t('notifications.settings.deviceBlocked')
                        : t('notifications.settings.deviceOff')}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  {subscribed ? (
                    <Badge>{t('notifications.settings.onBadge')}</Badge>
                  ) : (
                    <Button
                      size="sm"
                      disabled={registrar === undefined || notification === undefined || busy}
                      onClick={() => toggleSubscription(true)}
                    >
                      {t('notifications.settings.enableButton')}
                    </Button>
                  )}
                </ItemActions>
              </Item>
              <Item size="lg">
                <ItemMedia variant="icon" tone="primary">
                  <Switch
                    checked={notifyDetails}
                    onCheckedChange={toggleDetails}
                    disabled={!subscribed || setDetails.isPending}
                    aria-label={t('notifications.settings.detailsSwitch')}
                  />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{t('notifications.settings.detailsTitle')}</ItemTitle>
                  <ItemDescription>{t('notifications.settings.detailsText')}</ItemDescription>
                </ItemContent>
              </Item>
            </ItemGroup>
          </Card>
          <p className="mt-2.5 px-1 text-sm text-muted-foreground">
            {t('notifications.settings.neutralHint')}
          </p>
        </section>
      </div>
    </SettingsShell>
  )
}

/** A stand-in for the browser surfaces a platform without them: the
 *  switches above are disabled before these are ever asked. */
const rejectedNotification: NotificationContainer = {
  permission: 'denied',
  requestPermission: async () => 'denied',
}

const emptyRegistrar: PushRegistrar = {
  subscribe: async () => {
    throw new Error('Push is not available on this device')
  },
  getSubscription: async () => null,
}
