import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StoredWish } from '@/data/local-store.ts'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
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
import { WishRow } from './wish-row.tsx'
import { authorName, wishById, wishesOf } from './wishlist-entries.ts'
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
  // The id, not the row: while the sheet is open a sync may re-deliver the
  // wish, and the editor must edit the wish as it is now, not a snapshot
  // frozen when the edit began. 'new' and an id stay apart: a wish the
  // sync removes while its sheet is open closes the sheet — an editor
  // that fell back to "new" would offer to re-create the removed wish.
  const [editingId, setEditingId] = useState<string | 'new' | undefined>(undefined)
  const editing =
    editingId === undefined || editingId === 'new' ? undefined : wishById(wishes, editingId)
  useEffect(() => {
    if (editingId !== undefined && editingId !== 'new' && editing === undefined) {
      setEditingId(undefined)
    }
  }, [editingId, editing])

  const mine = meId === undefined ? [] : wishesOf(wishes, meId)
  const author = meId === undefined ? undefined : authorName(meId, profiles, t('wishlist.me'))

  const addWish = (
    <Button size="sm" onClick={() => setEditingId('new')}>
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
                <Button onClick={() => setEditingId('new')}>
                  <Icon name="plus" />
                  {t('wishlist.addWish')}
                </Button>
              </EmptyMedia>
            </Empty>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {mine.map((wish) => (
              <WishRow key={wish.id} wish={wish} editable onEdit={() => setEditingId(wish.id)} />
            ))}
          </div>
        )}
      </div>

      <Fab aria-label={t('wishlist.addWish')} onClick={() => setEditingId('new')} />

      {editingId === 'new' && (
        <WishEditorSheet wish={undefined} onClose={() => setEditingId(undefined)} />
      )}
      {editing !== undefined && (
        <WishEditorSheet wish={editing} onClose={() => setEditingId(undefined)} />
      )}
    </WishlistShell>
  )
}

/**
 * The add-or-edit sheet (the prototype's wish sheet): the whole
 * title-details-link triple, the received switch when editing, and the
 * removal with its confirm. Saving sends the triple's replace first and
 * the mark or its clearing second, so a refused triple changes nothing and
 * a refused mark leaves the switch honest; the wish the sheet edits is
 * read from the store on every render, so a sync that lands mid-edit —
 * including the refusal's own sync — cannot leave the sheet driving a
 * stale row.
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
  // The switch's start is frozen at mount, and only a member's move of it
  // is sent: a mark another device landed while the sheet was open must
  // not be cleared (or re-marked) by a save that never touched the switch.
  const initialReceived = useRef(wish?.receivedAt !== undefined)
  const [received, setReceived] = useState(initialReceived.current)
  const [confirmRemove, setConfirmRemove] = useState(false)
  // The field errors wait for the first save attempt: a sheet the member
  // has just opened is not yet wrong (docs/design/README.md, "Field").
  const [attempted, setAttempted] = useState(false)

  const titleBlank = title.trim().length === 0
  // The client-side guard the field hint names, mirroring the API
  // contract's link rule (issue #18) — case-insensitive, so the
  // auto-capitalised `Https://…` a mobile keyboard types is a link.
  const linkInvalid = link.trim().length > 0 && !/^https?:\/\/\S+$/i.test(link.trim())
  const invalid = titleBlank || linkInvalid
  const pending =
    create.isPending ||
    update.isPending ||
    remove.isPending ||
    markReceived.isPending ||
    clearReceived.isPending

  const save = () => {
    setAttempted(true)
    if (invalid) return
    const input = {
      title: title.trim(),
      details: details.trim().length > 0 ? details.trim() : undefined,
      link: normaliseLinkScheme(link),
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
    // The triple's replace goes first, the mark or its clearing second: a
    // validation refusal changes nothing, and the switch's outcome rides
    // the same save — but only when the member moved the switch, so a
    // mark another device landed under the open sheet is never cleared by
    // an untouched switch (nor re-marked). Any refusal surfaces through
    // the toast, the sheet stays open, and the refusal's sync corrects
    // the stale row underneath (use-wishlist.ts).
    void (async () => {
      try {
        await update.mutateAsync({ wishId: wish.id, ...input })
        if (received !== initialReceived.current) {
          if (received && wish.receivedAt === undefined) {
            await markReceived.mutateAsync({ wishId: wish.id })
          }
          if (!received && wish.receivedAt !== undefined) {
            await clearReceived.mutateAsync({ wishId: wish.id })
          }
        }
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
          <Field data-invalid={(attempted && titleBlank) || undefined}>
            <FieldLabel htmlFor="wish-title">{t('wishlist.titleField')}</FieldLabel>
            <Input
              id="wish-title"
              value={title}
              maxLength={WISH_TITLE_MAX_LENGTH}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('wishlist.titlePlaceholder')}
              aria-invalid={(attempted && titleBlank) || undefined}
              aria-describedby={attempted && titleBlank ? 'wish-title-error' : undefined}
            />
            {attempted && titleBlank && (
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
          <Field data-invalid={(attempted && linkInvalid) || undefined}>
            <FieldLabel htmlFor="wish-link">{t('wishlist.linkField')}</FieldLabel>
            <Input
              id="wish-link"
              type="url"
              inputMode="url"
              value={link}
              maxLength={WISH_LINK_MAX_LENGTH}
              onChange={(event) => setLink(event.target.value)}
              placeholder={t('wishlist.linkPlaceholder')}
              aria-invalid={(attempted && linkInvalid) || undefined}
              aria-describedby={attempted && linkInvalid ? 'wish-link-error' : undefined}
            />
            {attempted && linkInvalid ? (
              <FieldError id="wish-link-error">{t('wishlist.linkRequired')}</FieldError>
            ) : (
              <FieldDescription>{t('wishlist.linkHint')}</FieldDescription>
            )}
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

/**
 * Mobile keyboards capitalise the first letter of a link, and the URL
 * scheme is case-insensitive by RFC 3986: the scheme is lowercased before
 * the wish is sent, so `Https://…` is a link, not a validation refusal.
 * The rest of the URL keeps its case — paths and queries can be
 * case-sensitive.
 */
function normaliseLinkScheme(link: string): string | undefined {
  const trimmed = link.trim()
  if (trimmed.length === 0) return undefined
  // The match already carries the `://`.
  return trimmed.replace(/^(https?):\/\//i, (match) => match.toLowerCase())
}
