import { Link } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type AdminMember,
  adminSpaceErrorMessage,
  useAdminSpace,
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
import { Icon } from '@/ui/icon.tsx'
import { Input } from '@/ui/input.tsx'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
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
 * the space header, its members with roles, and a settings sheet for the
 * name and default time zone. Access codes belong to ticket #9.
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
  const owners = list.filter((member) => member.role === 'owner').length

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/admin"
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <Icon name="chevron-left" className="size-4" />
        {t('admin.space.back')}
      </Link>

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
          <Icon name="settings" className="size-4" />
          {t('admin.space.settings')}
        </Button>
      </header>

      <section>
        <SectionHeader
          title={t('admin.space.members')}
          action={
            <Button size="sm" onClick={() => setProvisionOpen(true)}>
              <Icon name="plus" className="size-4" />
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
          <Card className="py-0">
            <ItemGroup>
              {list.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  spaceId={spaceId}
                  canDemote={member.role === 'owner' && owners > 1}
                />
              ))}
            </ItemGroup>
          </Card>
        )}
        <p className="mt-2.5 px-1 text-sm text-muted-foreground">
          {t('admin.space.lastOwnerNote')}
        </p>
      </section>

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
  const [confirmRole, setConfirmRole] = useState<'owner' | 'regular' | undefined>()

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
            <Icon name="crown" className="size-4" />
          </Button>
        ) : canDemote ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('admin.space.makeRegular')}
            onClick={() => setConfirmRole('regular')}
          >
            <Icon name="user" className="size-4" />
          </Button>
        ) : null}
      </ItemActions>
      {dialog !== undefined ? (
        <Dialog open onOpenChange={(open) => !open && setConfirmRole(undefined)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{dialog.title}</DialogTitle>
              <DialogDescription>{dialog.text}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setConfirmRole(undefined)}>
                {t('ui.close')}
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
  const zones = timezoneOptions(i18n.language as 'ru' | 'en', new Date())

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (updateSpace.isPending) return
    if (name.trim().length === 0) {
      setNameError(t('admin.space.nameRequired'))
      return
    }
    updateSpace.mutate(
      { name: name.trim(), timezone },
      {
        onSuccess: () => {
          onOpenChange(false)
          toast(t('admin.space.savedToast'))
        },
        onError: (error) => setNameError(adminSpaceErrorMessage(error, t)),
      },
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
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

  const close = () => {
    setName('')
    setRole('regular')
    setDisplayName('')
    setEmail('')
    setPhone('')
    setInterfaceLanguage('')
    setNameError(undefined)
    onOpenChange(false)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (provisionMember.isPending) return
    if (name.trim().length === 0) {
      setNameError(t('admin.space.memberNameRequired'))
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
          close()
          toast(t('admin.space.addedToast'))
        },
        onError: (error) => setNameError(adminSpaceErrorMessage(error, t)),
      },
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
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
              onChange={(event) => {
                setName(event.target.value)
                setNameError(undefined)
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
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="provision-member-email">{t('admin.space.emailLabel')}</FieldLabel>
            <Input
              id="provision-member-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="provision-member-phone">{t('admin.space.phoneLabel')}</FieldLabel>
            <Input
              id="provision-member-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="provision-member-language">
              {t('admin.space.languageLabel')}
            </FieldLabel>
            <Select
              id="provision-member-language"
              value={interfaceLanguage}
              onChange={(event) => setInterfaceLanguage(event.target.value as '' | 'ru' | 'en')}
            >
              <option value="">—</option>
              <option value="ru">{t('language.ru')}</option>
              <option value="en">{t('language.en')}</option>
            </Select>
          </Field>
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
