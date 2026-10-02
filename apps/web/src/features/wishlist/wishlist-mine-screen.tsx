import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StoredWish } from '@/data/local-store.ts'
import { getActiveMemberId } from '@/data/session-registry.ts'
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
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Fab } from '@/ui/fab.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/field.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Input } from '@/ui/input.tsx'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/sheet.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { Switch } from '@/ui/switch.tsx'
import { Textarea } from '@/ui/textarea.tsx'
import { toast } from '@/ui/toast.tsx'
import {
  useClearWishReceived,
  useCreateWish,
  useDeleteWish,
  useMarkWishReceived,
  useUpdateWish,
  useWishlistData,
  WISH_DETAILS_MAX_LENGTH,
  WISH_LINK_MAX_LENGTH,
  WISH_TITLE_MAX_LENGTH,
  wishlistErrorMessage,
} from './use-wishlist.ts'
import { authorName, linkDomain, wishesOf } from './wishlist-entries.ts'
import { WishlistShell } from './wishlist-shell.tsx'

/*
 * The member's own wishlist (docs/design/screens/wishlist-mine.html): every
 * wish they have made, creation order, received ones marked and struck
 * through. The editor is the sheet the prototype draws — one field set for
 * adding and editing, with the received switch and the removal beside it —
 * because an edit replaces the wish's whole triple (issue #18).
 */
export function WishlistMineScreen() {
  const { t } = useTranslation()
  const { snapshot, wishes, profiles, downloaded } = useWishlistData()
  const meId = getActiveMemberId()
  const [editing, setEditing] = useState<StoredWish | 'new' | undefined>(undefined)

  const mine = meId === undefined ? [] : wishesOf(wishes, meId)
  const author = meId === undefined ? undefined : authorName(meId, profiles, t('wishlist.me'))

  const addWish = (
    <Button size="sm" onClick={() => setEditing('new')}>
      <Icon name="plus" />
      {t('wishlist.addWish')}
    </Button>
  )

  return (
    <WishlistShell title={t('wishlist.mineTitle')} width="narrow" actions={addWish}>
      <div className="flex flex-col gap-6 pt-6">
        <div className="flex items-center gap-2.5">
          <Avatar size="sm" hue={hueFromId(meId ?? '')}>
            <AvatarFallback>{monogramOf(author ?? '·')}</AvatarFallback>
          </Avatar>
          <span className="font-mono text-meta tracking-wide text-muted-foreground uppercase">
            {t('wishlist.mineVisibleToFamily')}
          </span>
        </div>

        {snapshot.isPending ? (
          <div className="grid place-items-center py-10">
            <Spinner className="size-6" />
          </div>
        ) : !downloaded ? (
          <Card>
            <Empty>
              <EmptyMedia>
                <Icon name="cloud-off" />
              </EmptyMedia>
              <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
              <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
            </Empty>
          </Card>
        ) : mine.length === 0 ? (
          <Card>
            <Empty>
              <EmptyMedia>
                <Icon name="gift" />
              </EmptyMedia>
              <EmptyTitle>{t('wishlist.mineEmptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('wishlist.mineEmptyText')}</EmptyDescription>
              <EmptyMedia className="mt-3">
                <Button onClick={() => setEditing('new')}>
                  <Icon name="plus" />
                  {t('wishlist.addWish')}
                </Button>
              </EmptyMedia>
            </Empty>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {mine.map((wish) => (
              <WishRow key={wish.id} wish={wish} editable onEdit={() => setEditing(wish)} />
            ))}
          </div>
        )}
      </div>

      <Fab aria-label={t('wishlist.addWish')} onClick={() => setEditing('new')} />

      {editing !== undefined && (
        <WishEditorSheet
          wish={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(undefined)}
        />
      )}
    </WishlistShell>
  )
}

/** One wish row: the received mark strikes the title out; the author's
 *  rows carry the edit button (only the author can change a wish). */
export function WishRow({
  wish,
  editable = false,
  onEdit,
}: {
  wish: StoredWish
  editable?: boolean
  onEdit?: () => void
}) {
  const { t } = useTranslation()
  const received = wish.receivedAt !== undefined
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {received && (
            <span className="w-fit">
              <Badge variant="ok">{t('wishlist.receivedPill')}</Badge>
            </span>
          )}
          <span className={`text-h3 ${received ? 'text-muted-foreground line-through' : ''}`}>
            {wish.title}
          </span>
          {wish.details !== undefined && (
            <span className="text-sm text-muted-foreground">{wish.details}</span>
          )}
          {wish.link !== undefined && (
            <a
              href={wish.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1.5 text-sm text-accent hover:underline"
            >
              <Icon name="globe" className="size-4" />
              {linkDomain(wish.link)}
            </a>
          )}
        </div>
        {editable && (
          <Button variant="ghost" size="icon" aria-label={t('wishlist.edit')} onClick={onEdit}>
            <Icon name="edit" />
          </Button>
        )}
      </div>
    </Card>
  )
}

/**
 * The add-or-edit sheet (the prototype's wish sheet): the whole
 * title-details-link triple, the received switch when editing, and the
 * removal with its confirm. Saving sends the mutations; the sync they
 * trigger re-reads the partition, so the sheet closes on the request's own
 * answer and a refusal leaves the sheet open with the translated error.
 */
function WishEditorSheet({ wish, onClose }: { wish: StoredWish | undefined; onClose: () => void }) {
  const { t } = useTranslation()
  const create = useCreateWish()
  const update = useUpdateWish()
  const remove = useDeleteWish()
  const markReceived = useMarkWishReceived()
  const clearReceived = useClearWishReceived()
  const [title, setTitle] = useState(wish?.title ?? '')
  const [details, setDetails] = useState(wish?.details ?? '')
  const [link, setLink] = useState(wish?.link ?? '')
  const [received, setReceived] = useState(wish?.receivedAt !== undefined)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const titleBlank = title.trim().length === 0
  const pending = create.isPending || update.isPending || remove.isPending || markReceived.isPending

  const save = () => {
    if (titleBlank) return
    const input = {
      title: title.trim(),
      details: details.trim().length > 0 ? details.trim() : undefined,
      link: link.trim().length > 0 ? link.trim() : undefined,
    }
    if (wish === undefined) {
      create.mutate(input, {
        onSuccess: () => {
          toast(t('wishlist.createdToast'))
          onClose()
        },
        onError: (error) => toast(wishlistErrorMessage(error, t), 'danger'),
      })
      return
    }
    // The received switch rides its own use cases and the triple the
    // replace; any refusal surfaces through the toast and the sheet stays
    // open, while the refusal's sync corrects the stale row underneath
    // (use-wishlist.ts).
    void (async () => {
      try {
        if (received && wish.receivedAt === undefined) {
          await markReceived.mutateAsync({ wishId: wish.id })
        }
        if (!received && wish.receivedAt !== undefined) {
          await clearReceived.mutateAsync({ wishId: wish.id })
        }
        await update.mutateAsync({ wishId: wish.id, ...input })
        toast(t('wishlist.savedToast'))
        onClose()
      } catch (error) {
        toast(wishlistErrorMessage(error, t), 'danger')
      }
    })()
  }

  const removeWish = () => {
    if (wish === undefined) return
    remove.mutate(
      { wishId: wish.id },
      {
        onSuccess: () => {
          toast(t('wishlist.removedToast'))
          onClose()
        },
        onError: (error) => {
          setConfirmRemove(false)
          toast(wishlistErrorMessage(error, t), 'danger')
        },
      },
    )
  }

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose()
      }}
    >
      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            {wish === undefined ? t('wishlist.editorNewTitle') : t('wishlist.editorEditTitle')}
          </SheetTitle>
          <SheetDescription>{t('wishlist.editorSubtitle')}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4">
          <Field data-invalid={titleBlank || undefined}>
            <FieldLabel htmlFor="wish-title">{t('wishlist.titleField')}</FieldLabel>
            <Input
              id="wish-title"
              value={title}
              maxLength={WISH_TITLE_MAX_LENGTH}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('wishlist.titlePlaceholder')}
              aria-invalid={titleBlank || undefined}
              aria-describedby={titleBlank ? 'wish-title-error' : undefined}
            />
            {titleBlank && (
              <FieldError id="wish-title-error">{t('wishlist.titleRequired')}</FieldError>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="wish-details">{t('wishlist.detailsField')}</FieldLabel>
            <Textarea
              id="wish-details"
              value={details}
              maxLength={WISH_DETAILS_MAX_LENGTH}
              onChange={(event) => setDetails(event.target.value)}
              placeholder={t('wishlist.detailsPlaceholder')}
            />
            <FieldDescription>{t('wishlist.detailsHint')}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="wish-link">{t('wishlist.linkField')}</FieldLabel>
            <Input
              id="wish-link"
              type="url"
              inputMode="url"
              value={link}
              maxLength={WISH_LINK_MAX_LENGTH}
              onChange={(event) => setLink(event.target.value)}
              placeholder={t('wishlist.linkPlaceholder')}
            />
            <FieldDescription>{t('wishlist.linkHint')}</FieldDescription>
          </Field>
          {wish !== undefined && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3">
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">{t('wishlist.receivedSwitch')}</span>
                <span className="text-sm text-muted-foreground">{t('wishlist.receivedHint')}</span>
              </span>
              <Switch
                checked={received}
                onCheckedChange={(next) => setReceived(next === true)}
                aria-label={t('wishlist.receivedSwitch')}
              />
            </div>
          )}
        </div>
        <div className="mt-2 flex flex-col">
          <Button size="lg" disabled={pending} onClick={save}>
            {wish === undefined ? t('wishlist.add') : t('wishlist.save')}
          </Button>
          {wish !== undefined && (
            <Button
              variant="destructive"
              size="lg"
              className="mt-2.5"
              disabled={pending}
              onClick={() => setConfirmRemove(true)}
            >
              {t('wishlist.removeWish')}
            </Button>
          )}
        </div>
      </SheetContent>

      {confirmRemove && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !remove.isPending) setConfirmRemove(false)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('wishlist.removeConfirmTitle')}</DialogTitle>
              <DialogDescription>
                {t('wishlist.removeConfirmTextNamed', { name: wish?.title ?? '' })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={remove.isPending}
                onClick={() => setConfirmRemove(false)}
              >
                {t('ui.close')}
              </Button>
              <Button variant="destructive" disabled={remove.isPending} onClick={removeWish}>
                {t('wishlist.removeConfirmLabel')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Sheet>
  )
}
