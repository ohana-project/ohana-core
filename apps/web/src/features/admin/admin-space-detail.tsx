import { type FormEvent, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type AdminAccessCode,
  accessCodeErrorMessage,
  type IssuedAccessCode,
  useAccessCodes,
  useIssueAccessCode,
  useRevokeAccessCode,
} from '@/features/admin/use-access-codes.ts'
import {
  type AdminMember,
  adminSpaceErrorMessage,
  CONTACT_MIN_LENGTH,
  useAdminSpace,
  useArchiveMember,
  useChangeMemberRole,
  useProvisionMember,
  useSpaceMembers,
  useUpdateSpace,
} from '@/features/admin/use-admin-spaces.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { timezoneOptions } from '@/lib/timezones.ts'
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
import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/field.tsx'
import { Icon, type IconName } from '@/ui/icon.tsx'
import { Input } from '@/ui/input.tsx'
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/ui/sheet.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group.tsx'

/*
 * The administrative space screen (docs/design/screens/admin-space.html):
 * the space header, its members with roles, the access codes with their
 * statuses, and a settings sheet for the name and default time zone. The
 * plaintext code is shown once in the issue dialog — only its hash lives
 * on the server, so the list shows statuses, not codes.
 */

export function AdminSpaceDetail({ spaceId }: { spaceId: string }) {
  const { t, i18n } = useTranslation()
  const space = useAdminSpace(spaceId)
  const members = useSpaceMembers(spaceId)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [provisionOpen, setProvisionOpen] = useState(false)

  const dateFormatter = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' })

  if (space.isPending || members.isPending) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (space.isError) {
    return <ErrorState onRetry={() => void space.refetch()} />
  }
  if (members.isError) {
    return <ErrorState onRetry={() => void members.refetch()} />
  }

  const current = space.data
  const list = members.data
  // The archived members (issue #23) follow in their own section: they are
  // out of the space, but the administrative area keeps seeing them.
  const active = list.filter((member) => member.archivedAt === undefined)
  const archived = list.filter((member) => member.archivedAt !== undefined)
  const owners = active.filter((member) => member.role === 'owner').length

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <Avatar size="lg" hue={hueFromId(current.id)}>
            <AvatarFallback>{monogramOf(current.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="text-display-lg">{current.name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t('admin.space.createdOn', {
                date: dateFormatter.format(new Date(current.createdAt)),
              })}
              {' · '}
              {t('admin.space.timezoneMeta', { zone: current.timezone })}
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
          <Icon name="settings" />
          {t('admin.space.settings')}
        </Button>
      </header>

      <section>
        <SectionHeader
          title={t('admin.space.members')}
          action={
            <Button size="sm" onClick={() => setProvisionOpen(true)}>
              <Icon name="plus" />
              {t('admin.space.addMember')}
            </Button>
          }
        />
        {list.length === 0 ? (
          <Card>
            <Empty>
              <EmptyMedia>
                <Icon name="users" />
              </EmptyMedia>
              <EmptyTitle>{t('admin.space.noMembers')}</EmptyTitle>
            </Empty>
          </Card>
        ) : (
          <>
            <Card className="py-0">
              <ItemGroup>
                {active.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    spaceId={spaceId}
                    canDemote={member.role === 'owner' && owners > 1}
                  />
                ))}
              </ItemGroup>
            </Card>

            {archived.length > 0 ? (
              <section className="mt-4">
                <SectionHeader title={t('space.members.archivedTitle')} />
                <Card className="py-0">
                  <ItemGroup>
                    {archived.map((member) => (
                      <ArchivedMemberRow key={member.id} member={member} spaceId={spaceId} />
                    ))}
                  </ItemGroup>
                </Card>
                <p className="mt-2.5 px-1 text-sm text-muted-foreground">
                  {t('admin.space.archivedHint')}
                </p>
              </section>
            ) : null}
          </>
        )}
        <p className="mt-2.5 px-1 text-sm text-muted-foreground">
          {t('admin.space.lastOwnerNote')}
        </p>
      </section>

      <AccessCodesSection spaceId={spaceId} members={list} dateFormatter={dateFormatter} />

      <SpaceSettingsSheet
        spaceId={spaceId}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialName={current.name}
        initialTimezone={current.timezone}
      />
      <ProvisionMemberSheet
        spaceId={spaceId}
        open={provisionOpen}
        onOpenChange={setProvisionOpen}
      />
    </div>
  )
}

function MemberRow({
  member,
  spaceId,
  canDemote,
}: {
  member: AdminMember
  spaceId: string
  canDemote: boolean
}) {
  const { t } = useTranslation()
  const changeRole = useChangeMemberRole(spaceId)
  const archiveMember = useArchiveMember(spaceId)
  const [confirmRole, setConfirmRole] = useState<'owner' | 'regular' | undefined>()
  const [confirmArchive, setConfirmArchive] = useState(false)

  const contacts = [member.displayName, member.email, member.phone].filter(Boolean).join(' · ')

  const applyRole = () => {
    if (confirmRole === undefined) return
    changeRole.mutate(
      { memberId: member.id, role: confirmRole },
      {
        onSuccess: () => setConfirmRole(undefined),
        onError: (error) => toast(adminSpaceErrorMessage(error, t), 'danger'),
      },
    )
  }

  const dialog =
    confirmRole === undefined
      ? undefined
      : confirmRole === 'owner'
        ? {
            title: t('admin.space.makeOwnerTitle', { name: member.name }),
            text: t('admin.space.makeOwnerText'),
            confirm: t('admin.space.makeOwnerConfirm'),
          }
        : {
            title: t('admin.space.makeRegularTitle', { name: member.name }),
            text: t('admin.space.makeRegularText'),
            confirm: t('admin.space.makeRegularConfirm'),
          }

  const applyArchive = () => {
    archiveMember.mutate(
      { memberId: member.id },
      {
        onSuccess: () => {
          setConfirmArchive(false)
          toast(t('space.card.archivedToast', { name: member.name }))
        },
        onError: (error) => toast(adminSpaceErrorMessage(error, t), 'danger'),
      },
    )
  }

  return (
    <Item size="lg">
      <Avatar size="sm" hue={hueFromId(member.id)}>
        <AvatarFallback>{monogramOf(member.name)}</AvatarFallback>
      </Avatar>
      <ItemContent>
        <ItemTitle>{member.name}</ItemTitle>
        {contacts.length > 0 ? <ItemDescription>{contacts}</ItemDescription> : null}
      </ItemContent>
      <ItemActions>
        <Badge variant={member.role === 'owner' ? 'primary' : 'neutral'}>
          {t(member.role === 'owner' ? 'admin.space.ownerPill' : 'admin.space.regularPill')}
        </Badge>
        {member.role === 'regular' ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('admin.space.makeOwner')}
            onClick={() => setConfirmRole('owner')}
          >
            <Icon name="crown" />
          </Button>
        ) : canDemote ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('admin.space.makeRegular')}
            onClick={() => setConfirmRole('regular')}
          >
            <Icon name="user" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive"
          aria-label={t('space.card.archiveRow', { name: member.name })}
          onClick={() => setConfirmArchive(true)}
        >
          <Icon name="archive" />
        </Button>
      </ItemActions>
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
              <DialogTitle>{t('space.card.archiveTitle', { name: member.name })}</DialogTitle>
              <DialogDescription>{t('space.card.archiveText')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={archiveMember.isPending}
                onClick={() => setConfirmArchive(false)}
              >
                {t('ui.cancel')}
              </Button>
              <Button
                variant="destructive"
                disabled={archiveMember.isPending}
                onClick={applyArchive}
              >
                {t('space.card.archiveConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
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
                {t('ui.cancel')}
              </Button>
              <Button onClick={applyRole} disabled={changeRole.isPending}>
                {dialog.confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Item>
  )
}

/*
 * The archived member's row (issue #23): the pill and the archiving date,
 * and — while the private state exists — the restore through a new code.
 * Once the purge has run, the restore is no longer offered, and the row
 * says so.
 */
function ArchivedMemberRow({ member, spaceId }: { member: AdminMember; spaceId: string }) {
  const { t, i18n } = useTranslation()
  const issue = useIssueAccessCode(spaceId)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [issued, setIssued] = useState<string | undefined>()

  const dateFormatter = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' })
  const isPurged = member.privateStatePurgedAt !== undefined

  return (
    <Item size="lg" className="opacity-70">
      <Avatar size="sm" hue={hueFromId(member.id)}>
        <AvatarFallback>{monogramOf(member.name)}</AvatarFallback>
      </Avatar>
      <ItemContent>
        <ItemTitle>{member.name}</ItemTitle>
        <ItemDescription>
          {member.archivedAt === undefined
            ? null
            : t('space.members.archivedSince', {
                date: dateFormatter.format(new Date(member.archivedAt)),
              })}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Badge variant="neutral">{t('space.members.archivedPill')}</Badge>
        {!isPurged ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('space.card.restoreButton')}
            onClick={() => setConfirmRestore(true)}
          >
            {t('space.card.restoreConfirm')}
          </Button>
        ) : null}
      </ItemActions>
      {confirmRestore ? (
        // The restore is the code issuance (issue #23): the new code is the
        // way back in, shown once.
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !issue.isPending) setConfirmRestore(false)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('space.card.restoreTitle', { name: member.name })}</DialogTitle>
              <DialogDescription>{t('space.card.restoreText')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={issue.isPending}
                onClick={() => setConfirmRestore(false)}
              >
                {t('ui.cancel')}
              </Button>
              <Button
                disabled={issue.isPending}
                onClick={() =>
                  issue.mutate(
                    { memberId: member.id },
                    {
                      onSuccess: (result) => {
                        setConfirmRestore(false)
                        setIssued(result.code)
                        toast(t('space.card.restoredToast', { name: member.name }))
                      },
                      onError: (error) => toast(accessCodeErrorMessage(error, t), 'danger'),
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
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !issue.isPending) setIssued(undefined)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('space.card.issuedTitle')}</DialogTitle>
              <DialogDescription>{t('space.card.shownOnce')}</DialogDescription>
            </DialogHeader>
            <CodeDisplay code={issued} />
            <p className="text-center font-mono text-xs tracking-wide text-muted-foreground uppercase">
              {t('admin.codes.meta')}
            </p>
            <DialogFooter>
              <Button onClick={() => setIssued(undefined)}>{t('admin.codes.done')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Item>
  )
}

function SpaceSettingsSheet({
  spaceId,
  open,
  onOpenChange,
  initialName,
  initialTimezone,
}: {
  spaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initialName: string
  initialTimezone: string
}) {
  const { t, i18n } = useTranslation()
  const updateSpace = useUpdateSpace(spaceId)
  const [name, setName] = useState(initialName)
  const [timezone, setTimezone] = useState(initialTimezone)
  const [nameError, setNameError] = useState<string | undefined>()
  const zones = useMemo(
    () => timezoneOptions(i18n.language as 'ru' | 'en', new Date()),
    [i18n.language],
  )

  // Abandoned edits must not survive closing, and a background refetch must
  // not interrupt typing: the reset runs on the open transition only, during
  // render, so the first frame already shows the server's values.
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setName(initialName)
      setTimezone(initialTimezone)
      setNameError(undefined)
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (updateSpace.isPending) return
    if (name.trim().length === 0) {
      setNameError(t('admin.space.nameRequired'))
      return
    }
    // Only the changed fields travel; an unchanged sheet closes silently.
    const changes: { name?: string; timezone?: string } = {}
    if (name.trim() !== initialName) changes.name = name.trim()
    if (timezone !== initialTimezone) changes.timezone = timezone
    if (Object.keys(changes).length === 0) {
      onOpenChange(false)
      return
    }
    updateSpace.mutate(changes, {
      onSuccess: () => {
        onOpenChange(false)
        toast(t('admin.space.savedToast'))
      },
      onError: (error) => setNameError(adminSpaceErrorMessage(error, t)),
    })
  }

  // A mid-flight request owns the sheet: closing it would leave the
  // success/error callbacks with nowhere sensible to land.
  const handleOpenChange = (next: boolean) => {
    if (!next && updateSpace.isPending) return
    onOpenChange(next)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('admin.space.settingsTitle')}</SheetTitle>
        </SheetHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field data-invalid={nameError !== undefined || undefined}>
            <FieldLabel htmlFor="space-settings-name">{t('admin.space.nameLabel')}</FieldLabel>
            <Input
              id="space-settings-name"
              value={name}
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(undefined)
              }}
            />
            {nameError !== undefined ? (
              <FieldError>{nameError}</FieldError>
            ) : (
              <FieldDescription>{t('admin.space.nameHint')}</FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="space-settings-timezone">
              {t('admin.space.timezoneLabel')}
            </FieldLabel>
            <Select
              id="space-settings-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            >
              {zones.map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label}
                </option>
              ))}
            </Select>
            <FieldDescription>{t('admin.space.timezoneHint')}</FieldDescription>
          </Field>
          <SheetFooter>
            <Button type="submit" size="lg" disabled={updateSpace.isPending}>
              {t('admin.space.save')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function ProvisionMemberSheet({
  spaceId,
  open,
  onOpenChange,
}: {
  spaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const provisionMember = useProvisionMember(spaceId)
  const [name, setName] = useState('')
  const [role, setRole] = useState<'owner' | 'regular'>('regular')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [interfaceLanguage, setInterfaceLanguage] = useState<'' | 'ru' | 'en'>('')
  const [nameError, setNameError] = useState<string | undefined>()
  const [emailError, setEmailError] = useState<string | undefined>()
  const [phoneError, setPhoneError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | undefined>()

  // Abandoned edits must not survive into the next session: everything
  // resets on the open transition, during render, and a pending submission
  // keeps the sheet open until it settles.
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setName('')
      setRole('regular')
      setDisplayName('')
      setEmail('')
      setPhone('')
      setInterfaceLanguage('')
      setNameError(undefined)
      setEmailError(undefined)
      setPhoneError(undefined)
      setFormError(undefined)
    }
  }

  // A mid-flight request owns the sheet: closing it would leave the
  // success/error callbacks with nowhere sensible to land.
  const handleOpenChange = (next: boolean) => {
    if (!next && provisionMember.isPending) return
    onOpenChange(next)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (provisionMember.isPending) return
    const failures: { name?: string; email?: string; phone?: string } = {}
    if (name.trim().length === 0) failures.name = t('admin.space.memberNameRequired')
    if (email.trim().length > 0 && [...email.trim()].length < CONTACT_MIN_LENGTH) {
      failures.email = t('admin.space.tooShort', { count: CONTACT_MIN_LENGTH })
    }
    if (phone.trim().length > 0 && [...phone.trim()].length < CONTACT_MIN_LENGTH) {
      failures.phone = t('admin.space.tooShort', { count: CONTACT_MIN_LENGTH })
    }
    setNameError(failures.name)
    setEmailError(failures.email)
    setPhoneError(failures.phone)
    if (
      failures.name !== undefined ||
      failures.email !== undefined ||
      failures.phone !== undefined
    ) {
      return
    }
    provisionMember.mutate(
      {
        name: name.trim(),
        role,
        displayName: displayName.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        interfaceLanguage: interfaceLanguage === '' ? undefined : interfaceLanguage,
      },
      {
        onSuccess: () => {
          onOpenChange(false)
          toast(t('admin.space.addedToast'))
        },
        // A schema answer concerns the form as a whole, not one field.
        onError: (error) => setFormError(adminSpaceErrorMessage(error, t)),
      },
    )
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('admin.space.addMemberTitle')}</SheetTitle>
          <SheetDescription>{t('admin.space.addMemberDescription')}</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field data-invalid={nameError !== undefined || undefined}>
            <FieldLabel htmlFor="provision-member-name">
              {t('admin.space.memberNameLabel')}
            </FieldLabel>
            <Input
              id="provision-member-name"
              value={name}
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(undefined)
                setFormError(undefined)
              }}
            />
            {nameError !== undefined ? <FieldError>{nameError}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel>{t('admin.space.roleLabel')}</FieldLabel>
            <ToggleGroup
              value={[role]}
              onValueChange={(value) => {
                const next = value.at(-1)
                if (next === 'owner' || next === 'regular') setRole(next)
                setFormError(undefined)
              }}
            >
              <ToggleGroupItem value="regular">{t('admin.space.roleRegular')}</ToggleGroupItem>
              <ToggleGroupItem value="owner">{t('admin.space.roleOwner')}</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <p className="text-meta font-mono text-muted-foreground uppercase">
            {t('admin.space.profileTitle')}
          </p>
          <Field>
            <FieldLabel htmlFor="provision-member-display-name">
              {t('admin.space.displayNameLabel')}
            </FieldLabel>
            <Input
              id="provision-member-display-name"
              value={displayName}
              maxLength={200}
              onChange={(event) => {
                setDisplayName(event.target.value)
                setFormError(undefined)
              }}
            />
          </Field>
          <Field data-invalid={emailError !== undefined || undefined}>
            <FieldLabel htmlFor="provision-member-email">{t('admin.space.emailLabel')}</FieldLabel>
            <Input
              id="provision-member-email"
              type="email"
              value={email}
              maxLength={200}
              onChange={(event) => {
                setEmail(event.target.value)
                setEmailError(undefined)
                setFormError(undefined)
              }}
            />
            {emailError !== undefined ? <FieldError>{emailError}</FieldError> : null}
          </Field>
          <Field data-invalid={phoneError !== undefined || undefined}>
            <FieldLabel htmlFor="provision-member-phone">{t('admin.space.phoneLabel')}</FieldLabel>
            <Input
              id="provision-member-phone"
              type="tel"
              value={phone}
              maxLength={40}
              onChange={(event) => {
                setPhone(event.target.value)
                setPhoneError(undefined)
                setFormError(undefined)
              }}
            />
            {phoneError !== undefined ? <FieldError>{phoneError}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="provision-member-language">
              {t('admin.space.languageLabel')}
            </FieldLabel>
            <Select
              id="provision-member-language"
              value={interfaceLanguage}
              onChange={(event) => {
                setInterfaceLanguage(event.target.value as '' | 'ru' | 'en')
                setFormError(undefined)
              }}
            >
              <option value="">—</option>
              <option value="ru">{t('language.ru')}</option>
              <option value="en">{t('language.en')}</option>
            </Select>
          </Field>
          {formError !== undefined ? <FieldError>{formError}</FieldError> : null}
          <SheetFooter>
            <Button type="submit" size="lg" disabled={provisionMember.isPending}>
              {t('admin.space.add')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

/*
 * The access codes section (docs/design/screens/admin-space.html, «Коды
 * входа»): the space's codes with their statuses, one issue dialog
 * that shows the plaintext once, and a revoke confirmation. The list never
 * shows codes — the server stores only hashes — so each row names its
 * member instead.
 */

const statusPill: Record<
  AdminAccessCode['status'],
  {
    pill:
      | 'admin.codes.pillIssued'
      | 'admin.codes.pillRedeemed'
      | 'admin.codes.pillExpired'
      | 'admin.codes.pillReplaced'
      | 'admin.codes.pillRevoked'
    variant: 'primary' | 'ok' | 'warn' | 'neutral' | 'danger'
    icon: IconName
  }
> = {
  issued: { pill: 'admin.codes.pillIssued', variant: 'primary', icon: 'lock' },
  redeemed: { pill: 'admin.codes.pillRedeemed', variant: 'ok', icon: 'check' },
  expired: { pill: 'admin.codes.pillExpired', variant: 'warn', icon: 'clock' },
  replaced: { pill: 'admin.codes.pillReplaced', variant: 'neutral', icon: 'repeat' },
  revoked: { pill: 'admin.codes.pillRevoked', variant: 'danger', icon: 'x' },
}

const statusSub: Record<
  AdminAccessCode['status'],
  | 'admin.codes.subIssued'
  | 'admin.codes.subRedeemed'
  | 'admin.codes.subExpired'
  | 'admin.codes.subReplaced'
  | 'admin.codes.subRevoked'
> = {
  issued: 'admin.codes.subIssued',
  redeemed: 'admin.codes.subRedeemed',
  expired: 'admin.codes.subExpired',
  replaced: 'admin.codes.subReplaced',
  revoked: 'admin.codes.subRevoked',
}

function AccessCodesSection({
  spaceId,
  members,
  dateFormatter,
}: {
  spaceId: string
  members: AdminMember[]
  dateFormatter: Intl.DateTimeFormat
}) {
  const { t } = useTranslation()
  const codes = useAccessCodes(spaceId)
  const [issueOpen, setIssueOpen] = useState(false)

  const memberName = (memberId: string) =>
    members.find((member) => member.id === memberId)?.name ?? t('admin.codes.unknownMember')

  return (
    <section>
      <SectionHeader
        title={t('admin.codes.title')}
        action={
          <Button size="sm" onClick={() => setIssueOpen(true)} disabled={members.length === 0}>
            <Icon name="plus" />
            {t('admin.codes.issue')}
          </Button>
        }
      />
      {codes.isPending ? (
        <div className="grid place-items-center py-10">
          <Spinner className="size-6" />
        </div>
      ) : codes.isError ? (
        <ErrorState onRetry={() => void codes.refetch()} />
      ) : codes.data.length === 0 ? (
        <Card>
          <Empty>
            <EmptyMedia>
              <Icon name="lock" />
            </EmptyMedia>
            <EmptyTitle>{t('admin.codes.empty')}</EmptyTitle>
          </Empty>
        </Card>
      ) : (
        <Card className="py-0">
          <ItemGroup>
            {codes.data.map((code) => (
              <AccessCodeRow
                key={code.id}
                code={code}
                spaceId={spaceId}
                memberName={memberName(code.memberId)}
                dateFormatter={dateFormatter}
              />
            ))}
          </ItemGroup>
        </Card>
      )}
      <p className="mt-2.5 px-1 text-sm text-muted-foreground">{t('admin.codes.hint')}</p>

      <IssueCodeDialog
        spaceId={spaceId}
        members={members}
        open={issueOpen}
        onOpenChange={setIssueOpen}
      />
    </section>
  )
}

function AccessCodeRow({
  code,
  spaceId,
  memberName,
  dateFormatter,
}: {
  code: AdminAccessCode
  spaceId: string
  memberName: string
  dateFormatter: Intl.DateTimeFormat
}) {
  const { t } = useTranslation()
  const revoke = useRevokeAccessCode(spaceId)
  const [confirming, setConfirming] = useState(false)
  const meta = statusPill[code.status]

  const applyRevoke = () => {
    revoke.mutate(
      { codeId: code.id },
      {
        onSuccess: () => setConfirming(false),
        onError: (error) => toast(accessCodeErrorMessage(error, t), 'danger'),
      },
    )
  }

  return (
    <Item size="lg">
      <ItemMedia variant="icon">
        <Icon name={meta.icon} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{memberName}</ItemTitle>
        <ItemDescription>
          {t(statusSub[code.status], {
            member: memberName,
            date: dateFormatter.format(new Date(code.statusChangedAt)),
          })}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Badge variant={meta.variant}>{t(meta.pill)}</Badge>
        {code.status === 'issued' ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => setConfirming(true)}
          >
            {t('admin.codes.revoke')}
          </Button>
        ) : null}
      </ItemActions>
      {confirming ? (
        // A mid-flight revocation owns the dialog: it cannot be dismissed
        // until the request settles, so the callbacks land on a visible dialog.
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !revoke.isPending) setConfirming(false)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('admin.codes.revokeTitle')}</DialogTitle>
              <DialogDescription>
                {t('admin.codes.revokeText', { name: memberName })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={revoke.isPending}
                onClick={() => setConfirming(false)}
              >
                {t('ui.cancel')}
              </Button>
              <Button variant="destructive" onClick={applyRevoke} disabled={revoke.isPending}>
                {t('admin.codes.revokeConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Item>
  )
}

function IssueCodeDialog({
  spaceId,
  members,
  open,
  onOpenChange,
}: {
  spaceId: string
  members: AdminMember[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const issue = useIssueAccessCode(spaceId)
  const [memberId, setMemberId] = useState<string | undefined>(undefined)
  const [memberError, setMemberError] = useState<string | undefined>(undefined)
  const [issued, setIssued] = useState<IssuedAccessCode | undefined>(undefined)
  const [formError, setFormError] = useState<string | undefined>(undefined)

  // Abandoned state must not survive closing: everything resets on the open
  // transition, during render, and a pending request keeps the dialog until
  // it settles (the code is shown once — closing must not lose it).
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setMemberId(undefined)
      setMemberError(undefined)
      setIssued(undefined)
      setFormError(undefined)
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (!next && issue.isPending) return
    onOpenChange(next)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (issue.isPending) return
    if (memberId === undefined) {
      setMemberError(t('admin.codes.memberRequired'))
      return
    }
    issue.mutate(
      { memberId },
      {
        onSuccess: (result) => {
          setIssued(result)
          toast(t('admin.codes.issuedToast', { code: result.code }))
        },
        onError: (error) => setFormError(accessCodeErrorMessage(error, t)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {issued === undefined ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('admin.codes.issueTitle')}</DialogTitle>
              <DialogDescription>{t('admin.codes.issueDescription')}</DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} noValidate className="flex flex-col gap-4">
              <Field data-invalid={memberError !== undefined || undefined}>
                <FieldLabel htmlFor="issue-code-member">{t('admin.codes.memberLabel')}</FieldLabel>
                <Select
                  id="issue-code-member"
                  value={memberId ?? ''}
                  onChange={(event) => {
                    setMemberId(event.target.value === '' ? undefined : event.target.value)
                    setMemberError(undefined)
                    setFormError(undefined)
                  }}
                >
                  <option value="">—</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </Select>
                {memberError !== undefined ? (
                  <FieldError>{memberError}</FieldError>
                ) : (
                  <FieldDescription>{t('admin.codes.shownOnce')}</FieldDescription>
                )}
              </Field>
              {formError !== undefined ? <FieldError>{formError}</FieldError> : null}
              <DialogFooter>
                <Button type="submit" disabled={issue.isPending}>
                  {t('admin.codes.issueSubmit')}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('admin.codes.issueTitle')}</DialogTitle>
              <DialogDescription>{t('admin.codes.shownOnce')}</DialogDescription>
            </DialogHeader>
            <CodeDisplay code={issued.code} />
            <p className="text-center font-mono text-xs tracking-wide text-muted-foreground uppercase">
              {t('admin.codes.meta')}
            </p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)} disabled={issue.isPending}>
                {t('admin.codes.done')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
