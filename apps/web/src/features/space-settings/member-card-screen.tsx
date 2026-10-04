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
  useArchiveSpaceMember,
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
 * (issue #12, ADR-0005). The archive row removes the member from the space
 * while the family history keeps their name; an archived card explains what
 * the archive means and offers the restore through a new code (issue #23).
 */

/** The profile shape the card reads, with the archiving stamps (issue #23). */
interface CardProfile {
  role: 'owner' | 'regular'
  createdAt: string
  archivedAt?: string
  privateStatePurgedAt?: string
}

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
  // An archived member's card (issue #23): the owner sees the archive state
  // with the restore, everyone else sees the read-only profile with the pill.
  const isArchived = profile.archivedAt !== undefined
  const archivedAt = profile.archivedAt

  return (
    <SettingsShell title={title}>
      <div className="flex flex-col gap-6 pt-6">
        <header className="flex items-center gap-3.5">
          <Avatar size="lg" hue={hueFromId(profile.id)}>
            <AvatarFallback>{monogramOf(displayName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="text-display-lg">{displayName}</h1>
            {archivedAt !== undefined ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t('space.members.archivedSince', {
                  date: dateFormatter.format(new Date(archivedAt)),
                })}
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t('space.card.memberSince', {
                  date: dateFormatter.format(new Date(profile.createdAt)),
                })}
              </p>
            )}
          </div>
          {isArchived ? (
            <span className="ml-auto">
              <Badge variant="neutral">{t('space.members.archivedPill')}</Badge>
            </span>
          ) : null}
        </header>
        {isOwner ? (
          isArchived ? (
            <ArchivedOwnerSections
              memberId={memberId}
              displayName={displayName}
              profile={profile}
            />
          ) : (
            <OwnerSections memberId={memberId} displayName={displayName} profile={profile} />
          )
        ) : (
          <p className="px-1 text-sm text-muted-foreground">
            {t(profile.role === 'owner' ? 'admin.space.ownerPill' : 'admin.space.regularPill')}
          </p>
        )}{' '}
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
  profile: CardProfile
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const session = useMemberSessionStatus()
  const profiles = useSpaceProfiles()
  const changeRole = useChangeSpaceMemberRole()
  const issueCode = useIssueMemberAccessCode()
  const revokeCode = useRevokeMemberAccessCode()
  const revokeDevices = useRevokeMemberDevices()
  const archiveMember = useArchiveSpaceMember()

  const codeStatus = useMemberAccessCode(memberId)
  const devices = useMemberDevices(memberId)

  // The last-active-owner count (issue #23): the archived owners hold no
  // standing, so the space's protection counts the active ones only.
  const owners =
    profiles.data?.filter((member) => member.role === 'owner' && member.archivedAt === undefined)
      .length ?? 0
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
  const [confirmArchive, setConfirmArchive] = useState(false)

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
              <Icon name="plus" />
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

      <section>
        <SectionHeader title={t('space.card.spaceSection')} />
        <Card className="py-0">
          <Item size="lg">
            <ItemMedia variant="icon">
              <Icon name="archive" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('space.card.archiveRow', { name: displayName })}</ItemTitle>
              <ItemDescription>{t('space.card.archiveRowSub')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={isLastOwner}
                aria-label={t('space.card.archiveRow', { name: displayName })}
                onClick={() => setConfirmArchive(true)}
              >
                {t('space.card.archiveConfirm')}
              </Button>
            </ItemActions>
          </Item>
        </Card>
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

      {confirmArchive ? (
        // A mid-flight archiving owns the dialog: it cannot be dismissed
        // until the request settles, so the callbacks land on a visible
        // dialog.
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !archiveMember.isPending) setConfirmArchive(false)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('space.card.archiveTitle', { name: displayName })}</DialogTitle>
              <DialogDescription>{t('space.card.archiveText')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={archiveMember.isPending}
                onClick={() => setConfirmArchive(false)}
              >
                {t('ui.close')}
              </Button>
              <Button
                variant="destructive"
                disabled={archiveMember.isPending}
                onClick={() =>
                  archiveMember.mutate(
                    { memberId },
                    {
                      onSuccess: () => {
                        setConfirmArchive(false)
                        toast(t('space.card.archivedToast', { name: displayName }))
                      },
                      onError: (error) => toast(spaceSettingsErrorMessage(error, t), 'danger'),
                    },
                  )
                }
              >
                {t('space.card.archiveConfirm')}
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
                        // A refusal — the code was redeemed meanwhile, the
                        // member is gone, the session died — is spent: it is
                        // answered behind the refreshed row, not inside a
                        // dialog offering a doomed action. A lost network or
                        // a server fault keeps the dialog open for the retry.
                        const retryable =
                          !(error instanceof ApiError) ||
                          error.code === 'unexpected' ||
                          error.code === 'internal_error'
                        if (!retryable) setConfirmRevoke(false)
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

/*
 * The archived card (docs/design/screens/member-card.html, the archived
 * state): the explain card says what the archive keeps and what it hides,
 * and the restore issues the new code — the one action that brings the
 * member back with everything intact (issue #23, ADR-0005). Once the
 * private state is purged, the restore is no longer offered, and the card
 * says so instead.
 */
function ArchivedOwnerSections({
  memberId,
  displayName,
  profile,
}: {
  memberId: string
  displayName: string
  profile: CardProfile
}) {
  const { t, i18n } = useTranslation()
  const issueCode = useIssueMemberAccessCode()
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [issued, setIssued] = useState<string | undefined>()

  const dateFormatter = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' })
  const isPurged = profile.privateStatePurgedAt !== undefined
  const archivedAt = profile.archivedAt

  return (
    <>
      <section>
        <Card className="py-0">
          <Item size="lg">
            <ItemContent>
              <ItemTitle>
                {archivedAt === undefined
                  ? null
                  : t('space.card.archivedSinceTitle', {
                      name: displayName,
                      date: dateFormatter.format(new Date(archivedAt)),
                    })}
              </ItemTitle>
            </ItemContent>
          </Item>
          <Item size="lg">
            <ItemMedia variant="icon">
              <Icon name="check" className="text-ok" />
            </ItemMedia>
            <ItemContent>
              <ItemDescription>{t('space.card.archivedKept')}</ItemDescription>
            </ItemContent>
          </Item>
          <Item size="lg">
            <ItemMedia variant="icon">
              <Icon name="x" className="text-destructive" />
            </ItemMedia>
            <ItemContent>
              <ItemDescription>{t('space.card.archivedHidden')}</ItemDescription>
            </ItemContent>
          </Item>
        </Card>
      </section>

      {isPurged ? (
        <p className="px-1 text-sm text-muted-foreground">{t('space.card.purgedNote')}</p>
      ) : (
        <section>
          <Button size="lg" className="w-full" onClick={() => setConfirmRestore(true)}>
            <Icon name="restore" />
            {t('space.card.restoreButton')}
          </Button>
          <p className="mt-2.5 px-1 text-center text-sm text-muted-foreground">
            {t('space.card.restoreHint', { name: displayName })}
          </p>
        </section>
      )}

      {confirmRestore ? (
        // The restore is the code issuance (issue #23): the confirm hands
        // over to the issued dialog, which owns the plaintext until it is
        // dismissed.
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !issueCode.isPending) setConfirmRestore(false)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('space.card.restoreTitle', { name: displayName })}</DialogTitle>
              <DialogDescription>{t('space.card.restoreText')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={issueCode.isPending}
                onClick={() => setConfirmRestore(false)}
              >
                {t('ui.close')}
              </Button>
              <Button
                disabled={issueCode.isPending}
                onClick={() =>
                  issueCode.mutate(
                    { memberId },
                    {
                      onSuccess: (result) => {
                        setConfirmRestore(false)
                        setIssued(result.code)
                        toast(t('space.card.restoredToast', { name: displayName }))
                      },
                      onError: (error) => toast(spaceSettingsErrorMessage(error, t), 'danger'),
                    },
                  )
                }
              >
                {t('space.card.restoreConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {issued !== undefined ? (
        // The plaintext code shows once — the same dialog the issue flow
        // uses; closing it loses the code, as everywhere else.
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !issueCode.isPending) setIssued(undefined)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('space.card.issuedTitle')}</DialogTitle>
              <DialogDescription>{t('space.card.shownOnce')}</DialogDescription>
            </DialogHeader>
            <CodeDisplay code={issued} />
            <p className="text-center font-mono text-xs tracking-wide text-muted-foreground uppercase">
              {t('space.invite.expiresMeta')}
            </p>
            <DialogFooter>
              <Button onClick={() => setIssued(undefined)}>{t('space.invite.done')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
