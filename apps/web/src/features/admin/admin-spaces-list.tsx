import { Link } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminSettings } from '@/features/admin/use-admin-settings.ts'
import {
  type AdminSpace,
  adminSpaceErrorMessage,
  useAdminSpaces,
  useCreateSpace,
} from '@/features/admin/use-admin-spaces.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Badge } from '@/ui/badge.tsx'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { ErrorState } from '@/ui/error-state.tsx'
import { Field, FieldError, FieldLabel } from '@/ui/field.tsx'
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

/*
 * The administrative spaces list (docs/design/screens/admin-spaces.html):
 * a calm card of rows, one main action («Новое пространство»), and the
 * independence note as the closing meta line.
 */

export function AdminSpacesList() {
  const { t, i18n } = useTranslation()
  const spaces = useAdminSpaces()
  const settings = useAdminSettings()
  const [createOpen, setCreateOpen] = useState(false)

  const dateFormatter = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' })

  return (
    <div className="flex flex-col gap-4">
      {/* The prototype's `row-between`: title and action share one row,
          centred, 20px above the list (the header's own margin). The
          title block flexes down to the title itself, so the subtitle
          narrows first and the action wraps only when the two truly
          cannot share a row — no horizontal scroll from 360px. */}
      <header className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div className="flex-1">
          <h1 className="text-display-lg">{t('admin.spaces.title')}</h1>
          {spaces.data !== undefined ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {t('admin.spaces.count', { count: spaces.data.length })}
              {settings.data !== undefined
                ? ` · ${t('admin.spaces.trashRetention', { count: settings.data.trashRetentionDays })}`
                : null}
            </p>
          ) : null}
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Icon name="plus" />
          {t('admin.spaces.new')}
        </Button>
      </header>

      {spaces.isPending ? (
        <div className="grid place-items-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : spaces.isError ? (
        <ErrorState onRetry={() => void spaces.refetch()} />
      ) : spaces.data.length === 0 ? (
        // The empty state stands on its own, no card around it (README
        // "Implementation"); the plate carries the 28px icon.
        <Empty>
          <EmptyMedia>
            <Icon name="users" />
          </EmptyMedia>
          <EmptyTitle>{t('admin.spaces.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('admin.spaces.emptyText')}</EmptyDescription>
        </Empty>
      ) : (
        <Card variant="list">
          <ItemGroup>
            {spaces.data.map((space) => (
              <SpaceRow key={space.id} space={space} dateFormatter={dateFormatter} />
            ))}
          </ItemGroup>
        </Card>
      )}

      <p className="text-meta font-mono text-muted-foreground uppercase">
        {t('admin.spaces.independenceNote')}
      </p>

      <CreateSpaceSheet open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function SpaceRow({
  space,
  dateFormatter,
}: {
  space: AdminSpace
  dateFormatter: Intl.DateTimeFormat
}) {
  const { t } = useTranslation()
  const isEmpty = space.memberCount === 0
  return (
    // The prototype's 68px row (`min-height: 68px`) with the space's own
    // 40px monogram (README: the avatar stack of the prototype becomes
    // the space's monogram here) and the 18px trailing chevron.
    <Item size="xl" render={<Link to="/admin/spaces/$spaceId" params={{ spaceId: space.id }} />}>
      <Avatar hue={hueFromId(space.id)}>
        <AvatarFallback>{monogramOf(space.name)}</AvatarFallback>
      </Avatar>
      <ItemContent>
        <ItemTitle>{space.name}</ItemTitle>
        <ItemDescription>
          {t('members.count', { count: space.memberCount })} ·{' '}
          {t('admin.spaces.createdOn', { date: dateFormatter.format(new Date(space.createdAt)) })}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Badge variant={isEmpty ? 'neutral' : 'ok'}>
          {t(isEmpty ? 'admin.spaces.empty' : 'admin.spaces.active')}
        </Badge>
        <Icon name="chevron-right" className="text-muted-foreground" />
      </ItemActions>
    </Item>
  )
}

export function CreateSpaceSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const createSpace = useCreateSpace()
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | undefined>()

  // Abandoned edits must not survive into the next session: everything
  // resets on the open transition, during render, and a pending submission
  // keeps the sheet open until it settles.
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setName('')
      setNameError(undefined)
    }
  }

  // A mid-flight request owns the sheet: closing it would leave the
  // success/error callbacks with nowhere sensible to land.
  const handleOpenChange = (next: boolean) => {
    if (!next && createSpace.isPending) return
    onOpenChange(next)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (createSpace.isPending) return
    if (name.trim().length === 0) {
      setNameError(t('admin.spaces.nameRequired'))
      return
    }
    createSpace.mutate(
      { name: name.trim() },
      {
        onSuccess: () => {
          onOpenChange(false)
          toast(t('admin.spaces.createdToast'))
        },
        onError: (error) => setNameError(adminSpaceErrorMessage(error, t)),
      },
    )
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('admin.spaces.newTitle')}</SheetTitle>
          <SheetDescription>{t('admin.spaces.newDescription')}</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field data-invalid={nameError !== undefined || undefined}>
            <FieldLabel htmlFor="new-space-name">{t('admin.spaces.nameLabel')}</FieldLabel>
            <Input
              id="new-space-name"
              value={name}
              maxLength={200}
              placeholder={t('admin.spaces.namePlaceholder')}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(undefined)
              }}
            />
            {nameError !== undefined ? <FieldError>{nameError}</FieldError> : null}
          </Field>
          <SheetFooter>
            <Button type="submit" size="lg" disabled={createSpace.isPending}>
              {t('admin.spaces.create')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
