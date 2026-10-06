import type { KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StoredWish } from '@/data/local-store.ts'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { cn } from '@/lib/cn'
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
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Field, FieldError, FieldLabel } from '@/ui/field.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Input } from '@/ui/input.tsx'
import { NoteBlock } from '@/ui/note-block.tsx'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/sheet.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { Switch } from '@/ui/switch.tsx'
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
import { formatMoment, wishById, wishesOf, wishlistUpdatedAt } from './wishlist-entries.ts'
import { WishlistShell } from './wishlist-shell.tsx'

/*
 * The member's own wishlist (docs/design/screens/wishlist-mine.html, issue
 * #68): the display heading with the muted visibility line, the surprise
 * note, the wish rows with their edit control, the dashed add tile closing
 * the list, and the mono footer line. The back arrow rides the top bar
 * below 920px, and no top-bar action or FAB competes with the tile — the
 * list's one main action. Every wish they have made, creation order,
 * received ones marked and struck through. The editor is the sheet the
 * prototype draws — one field set for adding and editing, with the
 * received switch and the removal beside it — because an edit replaces the
 * wish's whole triple (issue #18).
 */
export function WishlistMineScreen() {
  const { t, i18n } = useTranslation()
  const { snapshot, wishes, downloaded } = useWishlistData()
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
  const updated = wishlistUpdatedAt(mine)

  return (
    <WishlistShell title={t('wishlist.mineTitle')} backTo="/wishlist" width="narrow">
      {snapshot.isPending ? (
        <div className="grid place-items-center py-10">
          <Spinner className="size-6" />
        </div>
      ) : !downloaded ? (
        <Card className="mt-5">
          <Empty>
            <EmptyMedia>
              <Icon name="cloud-off" />
            </EmptyMedia>
            <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
            <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
          </Empty>
        </Card>
      ) : (
        // The prototype's column: the header's 14px under it, the note's
        // 18px, the list's 12px between rows, the footer's 18px — the
        // margins the prototype sets between the blocks.
        <div className="flex flex-col pt-5">
          <header className="mb-3.5">
            <h1 className="text-display-lg">{t('wishlist.mineTitle')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {updated === undefined
                ? t('wishlist.mineVisibleToFamily')
                : `${t('wishlist.mineVisibleToFamily')} · ${t('wishlist.updated', {
                    moment: formatMoment(updated, i18n.language),
                  })}`}
            </p>
          </header>

          {/* The surprise rule (the prototype's venue-note): reservations on
              the member's wishes never reach their author. */}
          <NoteBlock icon="eye-off" className="mb-4.5">
            <p className="leading-normal">{t('wishlist.mineSurpriseNote')}</p>
          </NoteBlock>

          {mine.length === 0 ? (
            // The prototype's empty state, bare: the list — the tile with
            // it — yields to the round plate, the text and the button.
            <Empty className="py-14">
              <EmptyMedia>
                <Icon name="gift" />
              </EmptyMedia>
              <EmptyTitle>{t('wishlist.mineEmptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('wishlist.mineEmptyText')}</EmptyDescription>
              <EmptyContent>
                <Button onClick={() => setEditingId('new')}>
                  <Icon name="plus" />
                  {t('wishlist.addWish')}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {mine.map((wish) => (
                <WishRow key={wish.id} wish={wish} editable onEdit={() => setEditingId(wish.id)} />
              ))}
              <AddWishTile onClick={() => setEditingId('new')} />
            </div>
          )}

          <p className="mx-1 mt-4.5 font-mono text-meta uppercase text-muted-foreground">
            {t('wishlist.mineFooter')}
          </p>
        </div>
      )}

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
 * The prototype's `.attach-tile` closing the list (issue #68): a
 * full-width dashed tile at the prototype's 52px floor that turns accent
 * on hover — the screen's one main action, the top bar's `d-only` button
 * and the FAB having left with the demo chrome. Feature code, like the
 * other wish pieces: no other screen draws this tile.
 */
function AddWishTile({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-13 w-full flex-none items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-[color-mix(in_oklch,var(--fg)_25%,var(--border))] p-3.5',
        'text-meta text-muted-foreground transition-colors duration-(--t-fast) ease-(--ease)',
        'hover:border-primary hover:bg-primary-soft hover:text-primary',
      )}
    >
      <Icon name="plus" className="size-4.5" />
      {t('wishlist.addWish')}
    </button>
  )
}

/**
 * The add-or-edit sheet (the prototype's wish sheet, issue #68): the
 * title, the link and the single-line hint in the prototype's order, the
 * received switch when editing, and the removal with its confirm. Saving
 * sends the triple's replace first and the mark or its clearing second, so
 * a refused triple changes nothing and a refused mark leaves the switch
 * honest. Enter from any field saves, like the prototype. The fields are
 * seeded from the wish at mount and then hold the member's typing — a save
 * is this sheet's last word on the triple, over whatever a mid-edit sync
 * delivered (last write wins; the sheet never remounts under a
 * re-delivered wish, so the typing survives). What the sheet does read
 * from the store on every render is the wish's identity, its received
 * mark, and the title the removal confirm names, so the switch's move is
 * decided against the row as it is now, and a refusal's own sync corrects
 * the row underneath (use-wishlist.ts) without touching the open fields.
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

  // Enter from any field saves — the prototype's keydown handler verbatim
  // (`if (e.key === 'Enter' && e.target.closest('.input')) save()`). It
  // rides a keydown, not a form: Base UI's button is always a plain
  // type="button", and a form would either double-fire through the save
  // button's click or never fire at all where clicks do not activate.
  const sheetKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && (event.target as HTMLElement).closest('input')) {
      event.preventDefault()
      save()
    }
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
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the prototype's keydown handler on the sheet's body — Enter from any field saves; the fields are the interactive elements the key lands on */}
        <div className="flex flex-col gap-4" onKeyDown={sheetKeyDown}>
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
            {attempted && linkInvalid && (
              <FieldError id="wish-link-error">{t('wishlist.linkRequired')}</FieldError>
            )}
          </Field>
          {/* The prototype's «Подсказка» — the wire's `details`, a single
              line like the prototype's input. */}
          <Field>
            <FieldLabel htmlFor="wish-details">{t('wishlist.detailsField')}</FieldLabel>
            <Input
              id="wish-details"
              inputMode="text"
              value={details}
              maxLength={WISH_DETAILS_MAX_LENGTH}
              onChange={(event) => setDetails(event.target.value)}
              placeholder={t('wishlist.detailsPlaceholder')}
            />
          </Field>
          {wish !== undefined && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3.5 py-3">
              <span className="flex min-w-0 flex-col">
                {/* The prototype sets no small size on the title — it rides
                    the sheet's body size; only its hint line is small. */}
                <span className="font-medium">{t('wishlist.receivedSwitch')}</span>
                <span className="text-sm text-muted-foreground">{t('wishlist.receivedHint')}</span>
              </span>
              <Switch
                checked={received}
                onCheckedChange={(next) => setReceived(next === true)}
                aria-label={t('wishlist.receivedSwitch')}
              />
            </div>
          )}
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
                {t('ui.cancel')}
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
