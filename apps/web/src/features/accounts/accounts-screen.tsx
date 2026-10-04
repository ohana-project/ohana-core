import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthLayout } from '@/app/layouts/auth-layout.tsx'
import { ApiError } from '@/data/api-error.ts'
import { getActiveMemberId, listStoredSessions } from '@/data/session-registry.ts'
import {
  type MemberSessionRow,
  memberSessionsQueryKey,
  useMemberSessions,
  useRevokeMemberSession,
} from '@/features/accounts/use-member-sessions.ts'
import {
  forgetMember,
  useMemberSignOut,
  useSwitchMember,
} from '@/features/member/use-member-session.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Badge } from '@/ui/badge.tsx'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog.tsx'
import { Empty, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { ErrorState } from '@/ui/error-state.tsx'
import { Icon } from '@/ui/icon.tsx'
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
import { toast } from '@/ui/toast.tsx'

/*
 * The accounts screen (docs/design/screens/accounts.html, issue #10): the
 * retained sign-ins of this device, switching between them (ADR-0005: a
 * client-side choice between independent sessions), the active member's
 * device review with revocation, and the way out. Sign-in and sign-out
 * remove only that member's local data.
 */

function revokeSessionErrorMessage(error: unknown, translate: (key: string) => string): string {
  if (error instanceof ApiError && error.code === 'member_session_not_found') {
    return translate('accounts.errors.member_session_not_found')
  }
  return translate('accounts.errors.unexpected')
}

export function AccountsScreen() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const switchMember = useSwitchMember()
  const signOut = useMemberSignOut()

  // The active member is device state; keeping it in component state makes
  // the pill and the device review follow a switch immediately.
  const [activeId, setActiveId] = useState(getActiveMemberId())
  const retained = listStoredSessions()
  const active = retained.find((entry) => entry.memberId === activeId)

  // The review and the way out are pinned to this screen's active member,
  // not to whichever member is active in the registry by request time.
  const sessions = useMemberSessions(activeId)
  const revoke = useRevokeMemberSession()
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [revoking, setRevoking] = useState<MemberSessionRow | undefined>(undefined)

  const switchTo = (memberId: string) => {
    switchMember(memberId)
    setActiveId(memberId)
  }

  const dateFormatter = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' })
  const usedFormatter = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })

  /** Composes the captured parts; whichever part is missing is skipped. */
  const deviceName = (row: MemberSessionRow) => {
    if (row.browser.length > 0 && row.platform.length > 0) {
      return t('accounts.devices.name', { browser: row.browser, platform: row.platform })
    }
    if (row.browser.length > 0) return row.browser
    if (row.platform.length > 0) return row.platform
    return t('accounts.devices.unknown')
  }

  const applyRevoke = () => {
    if (revoking === undefined || activeId === undefined) return
    // Captured before the request: the dialog state clears on success, and
    // the row itself already knows whether this device is the one revoked.
    const wasCurrent = revoking.current
    revoke.mutate(
      { memberId: activeId, sessionId: revoking.id },
      {
        onSuccess: () => {
          setRevoking(undefined)
          if (wasCurrent) {
            // Ending the session that this device is using is also a
            // sign-out: the member's local data goes with it, exactly like
            // signing out. The screen follows the registry at once, so no
            // observer lingers on the departed member's key.
            forgetMember(queryClient, activeId)
            setActiveId(getActiveMemberId())
            void navigate({ to: '/' })
          } else {
            // Another device lost access; only this list changes.
            void queryClient.invalidateQueries({
              queryKey: memberSessionsQueryKey(activeId),
            })
          }
        },
        onError: (error) => toast(revokeSessionErrorMessage(error, t), 'danger'),
      },
    )
  }

  return (
    <AuthLayout footer={t('accounts.footer')}>
      <Link
        to="/"
        aria-label={t('accounts.back')}
        className="mb-4 inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Icon name="chevron-left" className="size-5" />
      </Link>
      <h1 className="text-display-lg">{t('accounts.title')}</h1>
      <p className="mt-1.5 mb-5 text-body text-muted-foreground">{t('accounts.description')}</p>

      <Card className="py-0">
        <ItemGroup>
          {retained.map((entry) => {
            const displayName = entry.displayName ?? entry.name
            const isActive = entry.memberId === activeId
            return (
              <Item
                key={entry.memberId}
                size="lg"
                render={
                  <button
                    type="button"
                    onClick={() => {
                      switchTo(entry.memberId)
                      // Switching means entering that space: the gate at /
                      // renders its home for the now-active member.
                      void navigate({ to: '/' })
                    }}
                    aria-current={isActive ? 'true' : undefined}
                    aria-label={t('accounts.switchTo', {
                      name: displayName,
                      space: entry.spaceName,
                    })}
                  />
                }
              >
                <ItemMedia>
                  <Avatar size="sm" hue={hueFromId(entry.memberId)}>
                    <AvatarFallback>{monogramOf(displayName)}</AvatarFallback>
                  </Avatar>
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    {displayName}
                    {isActive ? (
                      <Badge variant="ok" className="ml-2 align-middle">
                        {t('accounts.activePill')}
                      </Badge>
                    ) : null}
                  </ItemTitle>
                  <ItemDescription>{entry.spaceName}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Icon name="chevron-right" className="text-muted-foreground" />
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      </Card>

      <div className="mt-5 flex flex-col gap-2.5">
        <Button variant="secondary" size="lg" render={<Link to="/signin" />}>
          <Icon name="plus" />
          {t('accounts.addByCode')}
        </Button>
        {active !== undefined ? (
          <Button variant="ghost" className="text-destructive" onClick={() => setSignOutOpen(true)}>
            <Icon name="log-out" />
            {t('accounts.signOut', { space: active.spaceName })}
          </Button>
        ) : null}
      </div>

      {active !== undefined ? (
        <section className="mt-7">
          <SectionHeader title={t('accounts.devices.title')} />
          {sessions.isPending ? (
            <div className="grid place-items-center py-10">
              <Spinner className="size-6" />
            </div>
          ) : sessions.isError ? (
            <ErrorState onRetry={() => void sessions.refetch()} />
          ) : sessions.data.length === 0 ? (
            <Card>
              <Empty>
                <EmptyMedia>
                  <Icon name="phone" />
                </EmptyMedia>
                <EmptyTitle>{t('accounts.devices.empty')}</EmptyTitle>
              </Empty>
            </Card>
          ) : (
            <Card className="py-0">
              <ItemGroup>
                {sessions.data.map((row) => (
                  <Item key={row.id} size="lg">
                    <ItemMedia variant="icon">
                      <Icon name="phone" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{deviceName(row)}</ItemTitle>
                      <ItemDescription>
                        {t('accounts.devices.sub', {
                          created: dateFormatter.format(new Date(row.createdAt)),
                          used: usedFormatter.format(new Date(row.lastUsedAt)),
                        })}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      {row.current ? <Badge>{t('accounts.thisDevicePill')}</Badge> : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('accounts.devices.revoke')}
                        onClick={() => setRevoking(row)}
                      >
                        <Icon name="log-out" />
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            </Card>
          )}
          <p className="mt-2.5 px-1 text-sm text-muted-foreground">{t('accounts.devices.hint')}</p>
        </section>
      ) : null}

      {signOutOpen && active !== undefined ? (
        // A mid-flight sign-out owns the dialog: it cannot be dismissed
        // until the request settles, so the callbacks land on a visible dialog.
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !signOut.isPending) setSignOutOpen(false)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('accounts.signOutTitle', { space: active.spaceName })}</DialogTitle>
              <DialogDescription>{t('accounts.signOutText')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={signOut.isPending}
                onClick={() => setSignOutOpen(false)}
              >
                {t('ui.close')}
              </Button>
              <Button
                variant="destructive"
                disabled={signOut.isPending}
                onClick={() =>
                  signOut.mutate(active.memberId, {
                    onSuccess: () => {
                      setSignOutOpen(false)
                      // The registry falls back to another retained
                      // sign-in; the screen follows it at once, and the
                      // gate at / decides where that leads.
                      setActiveId(getActiveMemberId())
                      void navigate({ to: '/' })
                    },
                    onError: () => toast(t('accounts.signOutFailed'), 'danger'),
                  })
                }
              >
                {t('accounts.signOutConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {revoking !== undefined ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !revoke.isPending) setRevoking(undefined)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('accounts.devices.revokeTitle')}</DialogTitle>
              <DialogDescription>
                {t('accounts.devices.revokeText', {
                  device: deviceName(revoking),
                  space: active?.spaceName ?? '',
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={revoke.isPending}
                onClick={() => setRevoking(undefined)}
              >
                {t('ui.close')}
              </Button>
              <Button variant="destructive" onClick={applyRevoke} disabled={revoke.isPending}>
                {t('accounts.devices.revokeConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </AuthLayout>
  )
}
