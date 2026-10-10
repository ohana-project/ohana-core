import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthLayout } from '@/app/layouts/auth-layout.tsx'
import { ApiError } from '@/data/api-error.ts'
import { getActiveMemberId, listStoredSessions } from '@/data/session-registry.ts'
import { useDeviceSpaces } from '@/features/accounts/use-device-spaces.ts'
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
import { Avatar } from '@/ui/avatar.tsx'
import { AvatarStack } from '@/ui/avatar-stack.tsx'
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
import { Logo } from '@/ui/logo.tsx'
import { SectionHeader } from '@/ui/section-header.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'

/*
 * The accounts screen (docs/design/screens/accounts.html, issue #64): one
 * row per retained sign-in, naming the space — the row's stack and count
 * line read the same hook the Spaces sheet reads —, the «сейчас» pill and
 * the sync time on the active one, then the way in by code and the way
 * out. The header row carries the back button, the centred lockup and a
 * 44px spacer, inside the prototype's own 460px column. Below the list
 * lives the device review (issue #10) the prototype does not draw: the
 * decision to keep it is recorded in docs/design/README.md. Sign-in and
 * sign-out remove only that member's local data.
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
  // The rows read the same hook the Spaces sheet reads, so the two can
  // never disagree on a stack, a count line or the active mark.
  const spaces = useDeviceSpaces()

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
  // The active row's trailing «синхр. 14:32» (accounts.html): the
  // partition's own last successful sync, hour and minute.
  const syncedFormatter = new Intl.DateTimeFormat(i18n.language, {
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
    <AuthLayout footer={t('accounts.footer')} columnWidth={460} logo={false}>
      {/* The prototype's header row: the back button, the centred lockup
          and its 44px spacer — the equal flanks keep the lockup centred. */}
      <div className="mb-[22px] flex items-center justify-between gap-3">
        <Button
          variant="secondary"
          size="icon"
          render={<Link to="/" aria-label={t('accounts.back')} />}
        >
          <Icon name="chevron-left" />
        </Button>
        <Logo />
        <span className="size-11" aria-hidden="true" />
      </div>
      <h1 className="text-display">{t('accounts.title')}</h1>
      <p className="mt-1.5 mb-[22px] text-body text-muted-foreground">
        {t('accounts.description', { count: retained.length })}
      </p>

      <Card variant="list">
        <ItemGroup>
          {spaces.map((space) => {
            const displayName = space.session.displayName ?? space.session.name
            return (
              <Item
                key={space.session.memberId}
                size="xl"
                render={
                  <button
                    type="button"
                    onClick={() => {
                      switchTo(space.session.memberId)
                      // Switching means entering that space: the gate at /
                      // renders its home for the now-active member.
                      void navigate({ to: '/' })
                    }}
                    aria-current={space.active ? 'true' : undefined}
                    aria-label={t('accounts.switchToSpace', { space: space.session.spaceName })}
                  />
                }
              >
                <AvatarStack>
                  {space.marks.slice(0, 3).map((mark) => (
                    <Avatar key={mark.id} size="sm" hue={mark.hue}>
                      {mark.initials}
                    </Avatar>
                  ))}
                </AvatarStack>
                <ItemContent>
                  <ItemTitle>
                    {space.session.spaceName}
                    {space.active ? (
                      <Badge variant="ok" className="ml-2 align-middle">
                        {t('accounts.activePill')}
                      </Badge>
                    ) : null}
                  </ItemTitle>
                  <ItemDescription>{space.membersLabel ?? displayName}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  {space.active && space.syncedAt !== undefined ? (
                    <span className="font-mono text-meta tabular-nums">
                      {t('accounts.syncedTrailing', {
                        time: syncedFormatter.format(new Date(space.syncedAt)),
                      })}
                    </span>
                  ) : (
                    <Icon name="chevron-right" />
                  )}
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      </Card>

      <div className="mt-[18px] flex flex-col gap-2.5">
        <Button variant="secondary" size="lg" className="w-auto" render={<Link to="/signin" />}>
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
                {t('ui.cancel')}
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
                {t('ui.cancel')}
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
