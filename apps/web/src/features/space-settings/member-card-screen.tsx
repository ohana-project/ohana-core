import { Navigate, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/data/api-error.ts'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { useSpaceProfiles } from '@/features/member/use-space-profiles.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Badge } from '@/ui/badge.tsx'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { CodeDisplay } from '@/ui/code-display.tsx'
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
import { Select } from '@/ui/select.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'
import { SettingsShell } from './settings-shell.tsx'
import {
  type AccessCodeStatus,
  spaceSettingsErrorMessage,
  useChangeSpaceMemberRole,
  useIssueMemberAccessCode,
  useMemberAccessCode,
  useMemberDevices,
  useRevokeMemberAccessCode,
  useRevokeMemberDevices,
} from './use-space-settings.ts'

/*
 * The member card (docs/design/screens/member-card.html): the member's role,
 * their access code with its status, and their devices — the owner's
 * instruments; a regular member sees the read-only profile. Issuing a code
 * shows the plaintext once; disconnecting ends every session of the member
 * (issue #12, ADR-0005). Archiving arrives with its own ticket (#23).
 */

const codeStatusPill: Record<
  AccessCodeStatus['status'],
  {
    label:
      | 'space.card.codeIssued'
      | 'space.card.codeRedeemed'
      | 'space.card.codeExpired'
      | 'space.card.codeReplaced'
      | 'space.card.codeRevoked'
    variant: 'primary' | 'ok' | 'warn' | 'neutral' | 'danger'
  }
> = {
  issued: { label: 'space.card.codeIssued', variant: 'primary' },
  redeemed: { label: 'space.card.codeRedeemed', variant: 'ok' },
  expired: { label: 'space.card.codeExpired', variant: 'warn' },
  replaced: { label: 'space.card.codeReplaced', variant: 'neutral' },
  revoked: { label: 'space.card.codeRevoked', variant: 'danger' },
}

export function MemberCardScreen({ memberId }: { memberId: string }) {
  const { t, i18n } = useTranslation()
  const session = useMemberSessionStatus()
  const profiles = useSpaceProfiles()

  const isOwner = session.me?.member.role === 'owner'
  const profile = profiles.data?.find((candidate) => candidate.id === memberId)

  const dateFormatter = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' })

  if (profiles.isPending) {
    return (
      <SettingsShell title={t('space.card.title')}>
        <div className="grid place-items-center py-16">
          <Spinner className="size-6" />
        </div>
      </SettingsShell>
    )
  }
  if (profiles.isError) {
    return (
      <SettingsShell title={t('space.card.title')}>
        <div className="pt-6">
          <ErrorState onRetry={() => void profiles.refetch()} />
        </div>
      </SettingsShell>
    )
  }
  if (profile === undefined) {
    // The member is gone from this space's list: nothing to show.
    return <Navigate to="/members" replace />
  }

  const displayName = profile.displayName ?? profile.name
  const title = t('space.card.title', { name: displayName })

  return (
    <SettingsShell title={title}>
      <div className="flex flex-col gap-6 pt-6">
        <header className="flex items-center gap-3.5">
          <Avatar size="lg" hue={hueFromId(profile.id)}>
            <AvatarFallback>{monogramOf(displayName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="text-display-lg">{displayName}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t('space.card.memberSince', {
                date: dateFormatter.format(new Date(profile.createdAt)),
              })}
            </p>
          </div>
        </header>

        {isOwner ? (
          <OwnerSections memberId={memberId} displayName={displayName} profile={profile} />
        ) : (
          <p className="px-1 text-sm text-muted-foreground">
            {t(profile.role === 'owner' ? 'admin.space.ownerPill' : 'admin.space.regularPill')}
          </p>
        )}
      </div>
    </SettingsShell>
  )
}

function OwnerSections({
  memberId,
  displayName,
  profile,
}: {
  memberId: string
  displayName: string
  profile: { role: 'owner' | 'regular' }
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const session = useMemberSessionStatus()
  const profiles = useSpaceProfiles()
  const changeRole = useChangeSpaceMemberRole()
  const issueCode = useIssueMemberAccessCode()
  const revokeCode = useRevokeMemberAccessCode()
  const revokeDevices = useRevokeMemberDevices()

  const codeStatus = useMemberAccessCode(memberId)
  const devices = useMemberDevices(memberId)

  const owners = profiles.data?.filter((member) => member.role === 'owner').length ?? 0
  const isLastOwner = profile.role === 'owner' && owners <= 1
  // An owner may be reviewing their own card: disconnecting then ends this
  // device's own session and must sign the device out.
  const isSelf = memberId === session.me?.member.id

  const [confirmRole, setConfirmRole] = useState<'owner' | 'regular' | undefined>()
  const [issueOpen, setIssueOpen] = useState(false)
  const [issued, setIssued] = useState<string | undefined>()
  const [issueError, setIssueError] = useState<string | undefined>()
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)

  const dateFormatter = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })

  const deviceName = (device: { browser: string; platform: string }) => {
    if (device.browser.length > 0 && device.platform.length > 0) {
      return t('accounts.devices.name', { browser: device.browser, platform: device.platform })
    }
    if (device.browser.length > 0) return device.browser
    if (device.platform.length > 0) return device.platform
    return t('accounts.devices.unknown')
  }

  const applyRole = () => {
    if (confirmRole === undefined) return
    changeRole.mutate(
      { memberId, role: confirmRole },
      {
        onSuccess: () => {
          setConfirmRole(undefined)
          toast(t('space.card.roleUpdatedToast'))
        },
        onError: (error) => toast(spaceSettingsErrorMessage(error, t), 'danger'),
      },
    )
  }

  const dialog =
    confirmRole === undefined
      ? undefined
      : confirmRole === 'owner'
        ? {
            title: t('space.card.makeOwnerTitle', { name: displayName }),
            text: t('space.card.makeOwnerText'),
            confirm: t('space.card.makeOwnerConfirm'),
          }
        : {
            title: t('space.card.makeRegularTitle', { name: displayName }),
            text: t('space.card.makeRegularText'),
            confirm: t('space.card.makeRegularConfirm'),
          }

  return (
    <>
      <section>
        <SectionHeader title={t('space.card.roleTitle')} />
        <Card className="py-0">
          <Item size="lg">
            <ItemMedia variant="icon">
              <Icon name="shield" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('space.card.roleLabel')}</ItemTitle>
              <ItemDescription>{t('space.card.roleHint')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Select
                aria-label={t('space.card.roleLabel')}
                className="w-auto"
                value={profile.role}
                onChange={(event) => {
                  const next = event.target.value
                  if (next === 'owner' || next === 'regular') setConfirmRole(next)
                }}
              >
                {/* The last owner cannot return to regular: the option is
                    disabled here, and the API refuses it regardless. */}
                <option value="regular" disabled={isLastOwner}>
                  {t('admin.space.regularPill')}
                </option>
                <option value="owner">{t('admin.space.ownerPill')}</option>
              </Select>
            </ItemActions>
          </Item>
        </Card>
        <p className="mt-2.5 px-1 text-sm text-muted-foreground">
          {t('admin.space.lastOwnerNote')}
        </p>
      </section>

      <section>
        <SectionHeader
          title={t('space.card.accessTitle')}
          action={
            <Button size="sm" variant="secondary" onClick={() => setIssueOpen(true)}>
              <Icon name="plus" className="size-4" />
              {t('space.card.issueCode')}
            </Button>
          }
        />
        <Card className="py-0">
          {codeStatus.isPending ? (
            <div className="grid place-items-center py-6">
              <Spinner className="size-5" />
            </div>
          ) : codeStatus.isError ? (
            <ErrorState onRetry={() => void codeStatus.refetch()} />
          ) : codeStatus.data === null ? (
            <Item size="lg">
              <ItemMedia variant="icon">
                <Icon name="lock" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{t('space.card.codeNoneTitle')}</ItemTitle>
                <ItemDescription>{t('space.card.codeNoneHint')}</ItemDescription>
              </ItemContent>
            </Item>
          ) : (
            <Item size="lg">
              <ItemMedia variant="icon">
                <Icon name="lock" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{t('space.card.codeTitle')}</ItemTitle>
                <ItemDescription>
                  {t('space.card.codeStatusMeta', {
                    date: dateFormatter.format(new Date(codeStatus.data.statusChangedAt)),
                  })}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant={codeStatusPill[codeStatus.data.status].variant}>
                  {t(codeStatusPill[codeStatus.data.status].label)}
                </Badge>
                {codeStatus.data.status === 'issued' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setConfirmRevoke(true)}
                  >
                    {t('space.card.revokeCode')}
                  </Button>
                ) : null}
              </ItemActions>
            </Item>
          )}
        </Card>
        <p className="mt-2.5 px-1 text-sm text-muted-foreground">{t('space.card.accessHint')}</p>
      </section>

      <section>
        <SectionHeader
          title={t('space.card.devicesTitle')}
          action={
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => setConfirmDisconnect(true)}
              disabled={devices.isPending || (devices.data?.length ?? 0) === 0}
            >
              {t('space.card.disconnectAll')}
            </Button>
          }
        />
        {devices.isPending ? (
          <div className="grid place-items-center py-6">
            <Spinner className="size-5" />
          </div>
        ) : devices.isError ? (
          <ErrorState onRetry={() => void devices.refetch()} />
        ) : devices.data.length === 0 ? (
          <Card>
            <Empty>
              <EmptyMedia>
                <Icon name="phone" />
              </EmptyMedia>
              <EmptyTitle>{t('space.card.devicesEmpty')}</EmptyTitle>
            </Empty>
          </Card>
        ) : (
          <Card className="py-0">
            <ItemGroup>
              {devices.data.map((device) => (
                <Item key={device.id} size="lg">
                  <ItemMedia variant="icon">
                    <Icon name="phone" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{deviceName(device)}</ItemTitle>
                    <ItemDescription>
                      {t('accounts.devices.sub', {
                        created: dateFormatter.format(new Date(device.createdAt)),
                        used: dateFormatter.format(new Date(device.lastUsedAt)),
                      })}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          </Card>
        )}
        <p className="mt-2.5 px-1 text-sm text-muted-foreground">{t('space.card.devicesHint')}</p>
      </section>

      {dialog !== undefined ? (
        // A mid-flight role change owns the dialog: it cannot be dismissed
        // until the request settles, so the callbacks land on a visible dialog.
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !changeRole.isPending) setConfirmRole(undefined)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{dialog.title}</DialogTitle>
              <DialogDescription>{dialog.text}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={changeRole.isPending}
                onClick={() => setConfirmRole(undefined)}
              >
                {t('ui.close')}
              </Button>
              <Button onClick={applyRole} disabled={changeRole.isPending}>
                {dialog.confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {issueOpen ? (
        // The issue dialog is the one place the plaintext code shows; it
        // cannot be dismissed mid-flight without losing the shown-once code.
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !issueCode.isPending) {
              setIssueOpen(false)
              setIssued(undefined)
              setIssueError(undefined)
            }
          }}
        >
          <DialogContent>
            {issued === undefined ? (
              <>
                <DialogHeader>
                  <DialogTitle>{t('space.card.issueTitle', { name: displayName })}</DialogTitle>
                  <DialogDescription>{t('space.card.issueText')}</DialogDescription>
                </DialogHeader>
                {issueError !== undefined ? (
                  <p className="text-sm text-destructive">{issueError}</p>
                ) : null}
                <DialogFooter>
                  <Button
                    variant="secondary"
                    disabled={issueCode.isPending}
                    onClick={() => {
                      setIssueOpen(false)
                      setIssueError(undefined)
                    }}
                  >
                    {t('ui.close')}
                  </Button>
                  <Button
                    disabled={issueCode.isPending}
                    onClick={() =>
                      issueCode.mutate(
                        { memberId },
                        {
                          onSuccess: (result) => setIssued(result.code),
                          onError: (error) => setIssueError(spaceSettingsErrorMessage(error, t)),
                        },
                      )
                    }
                  >
                    {t('space.card.issueSubmit')}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>{t('space.card.issuedTitle')}</DialogTitle>
                  <DialogDescription>{t('space.card.shownOnce')}</DialogDescription>
                </DialogHeader>
                <CodeDisplay code={issued} />
                <p className="text-center font-mono text-xs tracking-wide text-muted-foreground uppercase">
                  {t('space.invite.expiresMeta')}
                </p>
                <DialogFooter>
                  <Button
                    onClick={() => {
                      setIssueOpen(false)
                      setIssued(undefined)
                    }}
                  >
                    {t('space.invite.done')}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      ) : null}

      {confirmDisconnect ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !revokeDevices.isPending) setConfirmDisconnect(false)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('space.card.disconnectTitle', { name: displayName })}</DialogTitle>
              <DialogDescription>
                {t('space.card.disconnectText', { count: devices.data?.length ?? 0 })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={revokeDevices.isPending}
                onClick={() => setConfirmDisconnect(false)}
              >
                {t('ui.close')}
              </Button>
              <Button
                variant="destructive"
                disabled={revokeDevices.isPending}
                onClick={() =>
                  revokeDevices.mutate(
                    { memberId },
                    {
                      onSuccess: () => {
                        setConfirmDisconnect(false)
                        toast(t('space.card.disconnectedToast'))
                        if (isSelf) {
                          // The owner disconnected themselves: the registry
                          // cleanup already ran (the hook owns it), and this
                          // device goes to the code screen.
                          void navigate({ to: '/' })
                        }
                      },
                      onError: (error) => toast(spaceSettingsErrorMessage(error, t), 'danger'),
                    },
                  )
                }
              >
                {t('space.card.disconnectConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {confirmRevoke ? (
        // A mid-flight revocation owns the dialog: it cannot be dismissed
        // until the request settles, so the callbacks land on a visible
        // dialog.
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !revokeCode.isPending) setConfirmRevoke(false)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('space.card.revokeCodeTitle')}</DialogTitle>
              <DialogDescription>
                {t('space.card.revokeCodeText', { name: displayName })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={revokeCode.isPending}
                onClick={() => setConfirmRevoke(false)}
              >
                {t('ui.close')}
              </Button>
              <Button
                variant="destructive"
                disabled={revokeCode.isPending}
                onClick={() =>
                  revokeCode.mutate(
                    { memberId },
                    {
                      onSuccess: () => {
                        setConfirmRevoke(false)
                        toast(t('space.card.revokedToast'))
                      },
                      onError: (error) => {
                        // A refusal — the code was redeemed, replaced, or
                        // revoked meanwhile — is answered behind the
                        // refreshed row, not inside a dialog offering a
                        // spent action. Any other failure (a lost network,
                        // say) keeps the dialog open for the retry.
                        if (error instanceof ApiError && error.code.startsWith('access_code_')) {
                          setConfirmRevoke(false)
                        }
                        toast(spaceSettingsErrorMessage(error, t), 'danger')
                      },
                    },
                  )
                }
              >
                {t('space.card.revokeCodeConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
